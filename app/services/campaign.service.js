const transporter = require("../config/mailer");
const Subscriber = require("../models/subscriber.model");
const BlogPost = require("../models/blogpost.model");
const campaignEmail = require("../templates/campaign.email");
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

function countAudience(audience) {
  return Subscriber.countDocuments(audienceFilter(audience));
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

async function sendTest(campaign, email) {
  const postUrl = await resolvePostUrl(campaign);
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

module.exports = { audienceFilter, countAudience, sendTest, processCampaign };
