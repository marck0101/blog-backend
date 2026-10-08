const transporter = require("../config/mailer");
const Subscriber = require("../models/subscriber.model");
const BlogPost = require("../models/blogpost.model");
const Campaign = require("../models/campaign.model");
const campaignEmail = require("../templates/campaign.email");
const escapeHtml = require("../utils/escapeHtml");
const { SITE_URL, unsubscribeUrl } = require("../config/urls");

// Orçamento de tempo por chamada de /send. A Vercel encerra a função
// (10s no plano hobby), então paramos antes e o painel chama de novo.
const TIME_BUDGET_MS = 7000;
const CONCURRENCY = 5;

function audienceFilter(audience = {}) {
  const filter = { status: "active" };

  switch (audience.type) {
    case "members":
      filter.tier = "member";
      break;
    case "categories":
      filter.categories = { $in: audience.categories || [] };
      break;
    case "selected":
      filter._id = { $in: audience.subscribers || [] };
      break;
    case "all":
    default:
      break;
  }

  if (audience.excludeMembers && ["all", "categories"].includes(audience.type)) {
    filter.tier = { $ne: "member" };
  }

  return filter;
}

function isMailerConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function countAudience(audience) {
  return Subscriber.countDocuments(audienceFilter(audience));
}

// Contagem + amostra de quem vai receber (para conferir antes de enviar)
async function previewAudience(audience, limit = 8) {
  const filter = audienceFilter(audience);
  const [count, sample] = await Promise.all([
    Subscriber.countDocuments(filter),
    Subscriber.find(filter, "name email tier").sort({ tier: -1, name: 1 }).limit(limit),
  ]);
  return { count, sample };
}

// Público configurado no post → público do envio ("post-category" segue a categoria atual)
function postAudience(post) {
  const a = post.emailAudience || {};
  if (!a.type || a.type === "post-category") {
    return { type: "categories", categories: [post.category], excludeMembers: Boolean(a.excludeMembers) };
  }
  return {
    type: a.type,
    categories: a.categories || [],
    subscribers: a.subscribers || [],
    excludeMembers: Boolean(a.excludeMembers),
  };
}

const defaultPostSubject = (post) => `Novo artigo: ${post.title} | marck0101`;

// Monta o envio (sem salvar) a partir do post e do que foi preparado nele
function campaignFromPost(post) {
  return new Campaign({
    kind: "post-notification",
    post: post._id,
    subject: (post.emailSubject || "").trim() || defaultPostSubject(post),
    preheader: (post.emailPreheader || "").trim() || post.excerpt || "",
    content: postTeaserHtml(post),
    audience: postAudience(post),
  });
}

// Link do post só se ele estiver publicado (rascunho não tem página pública)
async function resolvePostUrl(campaign) {
  if (!campaign.post) return null;
  const post = await BlogPost.findOne(
    { _id: campaign.post, published: true, deletedAt: null },
    "slug"
  );
  return post ? `${SITE_URL}/blog/${post.slug}` : null;
}

function buildMail(campaign, subscriber, postUrl) {
  const unsub = unsubscribeUrl(subscriber.token);

  return {
    from: `"marck0101" <${process.env.GMAIL_USER}>`,
    to: subscriber.email,
    subject: campaign.subject,
    headers: { "List-Unsubscribe": `<${unsub}>` },
    html: campaignEmail({
      subscriberName: subscriber.name,
      subject: campaign.subject,
      preheader: campaign.preheader,
      content: campaign.content,
      isMemberContent: campaign.audience?.type === "members",
      postUrl,
      unsubscribeUrl: unsub,
    }),
  };
}

// postUrl permite testar o botão de um post que ainda não foi publicado
async function sendTest(campaign, email, postUrlOverride) {
  const postUrl = postUrlOverride || (await resolvePostUrl(campaign));
  const mail = buildMail(campaign, { email, name: "teste", token: "teste" }, postUrl);
  return transporter.sendMail({ ...mail, subject: `[TESTE] ${mail.subject}` });
}

/**
 * Fixa a lista de destinatários na primeira chamada e envia os pendentes
 * até estourar o orçamento de tempo. Pode ser chamada várias vezes.
 */
async function processCampaign(campaign) {
  if (campaign.status === "draft") {
    const subscribers = await Subscriber.find(audienceFilter(campaign.audience), "_id email");
    campaign.recipients = subscribers.map((s) => ({ subscriber: s._id, email: s.email }));
    campaign.status = "sending";
    campaign.startedAt = new Date();
    await campaign.save();
  }

  const started = Date.now();
  const postUrl = await resolvePostUrl(campaign);
  const pending = campaign.recipients.filter((r) => r.status === "pending");

  // Carrega nome/token atualizados (e descarta quem cancelou nesse meio tempo)
  const subs = await Subscriber.find({
    _id: { $in: pending.map((r) => r.subscriber) },
  });
  const byId = new Map(subs.map((s) => [String(s._id), s]));

  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    if (Date.now() - started > TIME_BUDGET_MS) break;

    const batch = pending.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.map(async (recipient) => {
        const subscriber = byId.get(String(recipient.subscriber));

        if (!subscriber || subscriber.status !== "active") {
          recipient.status = "failed";
          recipient.error = "Assinante removido ou inscrição cancelada";
          return;
        }

        try {
          await transporter.sendMail(buildMail(campaign, subscriber, postUrl));
          recipient.status = "sent";
          recipient.sentAt = new Date();
        } catch (err) {
          recipient.status = "failed";
          recipient.error = err.message;
        }
      })
    );

    campaign.markModified("recipients");
    await campaign.save();
  }

  if (!campaign.recipients.some((r) => r.status === "pending")) {
    campaign.status = "sent";
    campaign.sentAt = new Date();
    await campaign.save();
    console.log(`[CAMPAIGN] "${campaign.subject}" concluído`, campaign.stats());
  }

  return campaign;
}

// Chamada do post para email: desperta interesse e leva ao blog (botão
// "Continuar lendo" vem do template), em vez de copiar o artigo inteiro.
function postTeaserHtml(post) {
  const teaser = (post.emailTeaser || "").trim() || post.excerpt || "";
  const paragraphs = teaser
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  return [
    post.coverImage
      ? `<p><img src="${escapeHtml(post.coverImage)}" alt="" style="width: 100%; height: auto; display: block;"></p>`
      : "",
    `<h2>${escapeHtml(post.title)}</h2>`,
    paragraphs,
  ].join("");
}

/**
 * Aviso de post novo: vira um envio registrado (aparece em Envios, com
 * destinatários e "tentar de novo"). Um aviso por post, mesmo que ele seja
 * despublicado e publicado de novo.
 */
async function notifyNewPost(post) {
  if (post.emailNotify === false) return null;

  const existing = await Campaign.findOne({ kind: "post-notification", post: post._id });
  if (existing) return existing;

  const campaign = await campaignFromPost(post).save();

  const count = await countAudience(campaign.audience);
  if (count === 0) {
    console.log(`[EMAIL] Nenhum destinatário para o aviso de "${post.title}"; fica como rascunho`);
    return campaign;
  }

  // Sem credenciais fica como rascunho, para enviar depois pelo painel
  if (!isMailerConfigured()) {
    console.error("[EMAIL] GMAIL_USER/GMAIL_APP_PASSWORD ausentes; aviso fica como rascunho");
    return campaign;
  }

  // Envia dentro da própria requisição (serverless não roda em background).
  // Se sobrar alguém, o envio fica "enviando" e dá para continuar em Envios.
  return processCampaign(campaign);
}

module.exports = {
  audienceFilter,
  countAudience,
  previewAudience,
  campaignFromPost,
  isMailerConfigured,
  sendTest,
  processCampaign,
  notifyNewPost,
};
