const mongoose = require("mongoose");
const connectDB = require("../config/db.config");
const Campaign = require("../models/campaign.model");
const User = require("../models/user.model");
const CATEGORIES = require("../config/categories");
const Subscriber = require("../models/subscriber.model");
const campaignService = require("../services/campaign.service");
const { SITE_URL } = require("../config/urls");

const VALID_SLUGS = CATEGORIES.map((c) => c.slug);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateAudience(audience) {
  if (!audience) return null;

  if (!Campaign.AUDIENCE_TYPES.includes(audience.type)) {
    return "Público inválido";
  }

  if (audience.type === "categories") {
    if (!audience.categories?.length) return "Selecione pelo menos 1 categoria";
    const invalid = audience.categories.filter((c) => !VALID_SLUGS.includes(c));
    if (invalid.length) return `Categorias inválidas: ${invalid.join(", ")}`;
  }

  if (audience.type === "selected") {
    if (!audience.subscribers?.length) return "Selecione pelo menos 1 assinante";
    if (!audience.subscribers.every((id) => mongoose.isValidObjectId(id))) {
      return "Assinante inválido";
    }
  }

  return null;
}

// Sem credenciais o nodemailer falha com "Missing credentials for PLAIN" em
// cada destinatário; melhor recusar antes de marcar todo mundo como falha.
function mailerNotConfigured(res) {
  if (campaignService.isMailerConfigured()) return false;
  res.status(503).json({
    error: "Envio de email não configurado no servidor: defina GMAIL_USER e GMAIL_APP_PASSWORD",
  });
  return true;
}

function validatePost(post) {
  if (post === undefined || post === null || post === "") return null;
  return mongoose.isValidObjectId(post) ? null : "Post inválido";
}

function pickEditable(body) {
  const data = {};
  for (const key of ["subject", "preheader", "content", "audience", "post"]) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  return data;
}

function serialize(campaign, { withRecipients = false } = {}) {
  const obj = campaign.toObject();
  obj.stats = campaign.stats();
  if (!withRecipients) delete obj.recipients;
  return obj;
}

// Mesmo critério do front (utils/campaignAudience.js → campaignStatusKey)
function statusKey(campaign) {
  if (campaign.status !== "sent") return campaign.status;
  const { sent, failed } = campaign.stats();
  if (failed > 0 && sent === 0) return "failed";
  if (failed > 0) return "partial";
  return "sent";
}

async function findDraft(id, res) {
  const campaign = await Campaign.findById(id);
  if (!campaign) {
    res.status(404).json({ error: "Envio não encontrado" });
    return null;
  }
  if (campaign.status !== "draft") {
    res.status(409).json({ error: "Este envio já foi iniciado e não pode ser alterado" });
    return null;
  }
  return campaign;
}

exports.findAll = async (req, res, next) => {
  try {
    await connectDB();

    // ?post= envios ligados a um post (ex.: o aviso automático dele)
    if (req.query.post && !mongoose.isValidObjectId(req.query.post)) {
      return res.status(400).json({ error: "Post inválido" });
    }

    // ?email= filtra envios que tiveram esse destinatário (busca parcial)
    const email = req.query.email?.trim().toLowerCase();
    const emailRe = email
      ? new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      : null;
    const filter = emailRe ? { "recipients.email": emailRe } : {};
    if (req.query.post) filter.post = req.query.post;

    if (req.query.kind === "custom") filter.kind = { $ne: "post-notification" };
    else if (req.query.kind === "post-notification") filter.kind = "post-notification";

    const campaigns = await Campaign.find(filter).sort({ createdAt: -1 });

    const toJson = (c) => {
      const obj = serialize(c);
      obj.audienceSize = c.audience?.subscribers?.length ?? 0;
      if (emailRe) {
        obj.matches = c.recipients
          .filter((r) => emailRe.test(r.email))
          .map(({ email, status, sentAt, error }) => ({ email, status, sentAt, error }));
      }
      return obj;
    };

    // Sem ?page= mantém a resposta antiga (array completo), usada pelo editor de post
    if (!req.query.page) return res.json(campaigns.map(toJson));

    // Mais recente primeiro pela data que a tela mostra: envio, início ou última edição
    const activity = (c) => (c.sentAt || c.startedAt || c.updatedAt || c.createdAt).getTime();
    let list = campaigns.sort((a, b) => activity(b) - activity(a));

    const status = req.query.status;
    if (status && status !== "all") list = list.filter((c) => statusKey(c) === status);

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const total = list.length;

    res.json({
      campaigns: list.slice((page - 1) * limit, page * limit).map(toJson),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

// Envios do mês para o calendário: data = envio, início do envio ou última edição (rascunho)
exports.calendar = async (req, res, next) => {
  try {
    await connectDB();

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const campaigns = await Campaign.find({
      $or: [
        { sentAt: { $gte: start, $lte: end } },
        { status: "sending", startedAt: { $gte: start, $lte: end } },
        { status: "draft", updatedAt: { $gte: start, $lte: end } },
      ],
    }).sort({ createdAt: 1 });

    res.json(
      campaigns.map((c) => ({
        _id: c._id,
        subject: c.subject,
        kind: c.kind,
        status: c.status,
        date: c.sentAt || c.startedAt || c.updatedAt,
        stats: c.stats(),
      }))
    );
  } catch (err) {
    next(err);
  }
};

exports.findOne = async (req, res, next) => {
  try {
    await connectDB();
    const campaign = await Campaign.findById(req.params.id)
      .populate("audience.subscribers", "name email tier")
      .populate("post", "title slug status published")
      .populate("recipients.subscriber", "name tier");
    if (!campaign) return res.status(404).json({ error: "Envio não encontrado" });
    res.json(serialize(campaign, { withRecipients: true }));
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    await connectDB();
    const data = pickEditable(req.body);

    const audienceError = validateAudience(data.audience) || validatePost(data.post);
    if (audienceError) return res.status(422).json({ error: audienceError });
    if (data.post === "") data.post = null;

    const campaign = await Campaign.create(data);
    res.status(201).json(serialize(campaign));
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    await connectDB();
    const campaign = await findDraft(req.params.id, res);
    if (!campaign) return;

    const data = pickEditable(req.body);
    const audienceError = validateAudience(data.audience) || validatePost(data.post);
    if (audienceError) return res.status(422).json({ error: audienceError });
    if (data.post === "") data.post = null;

    campaign.set(data);
    await campaign.save();
    res.json(serialize(campaign));
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    await connectDB();
    const campaign = await findDraft(req.params.id, res);
    if (!campaign) return;

    await campaign.deleteOne();
    res.json({ message: "Rascunho removido" });
  } catch (err) {
    next(err);
  }
};

exports.audienceCount = async (req, res, next) => {
  try {
    await connectDB();
    const audienceError = validateAudience(req.body.audience);
    if (audienceError) return res.json({ count: 0, sample: [] });

    res.json(await campaignService.previewAudience(req.body.audience));
  } catch (err) {
    next(err);
  }
};

exports.sendTest = async (req, res, next) => {
  try {
    if (mailerNotConfigured(res)) return;
    await connectDB();
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Envio não encontrado" });

    let email = req.body.email;
    if (!email) {
      const admin = await User.findById(req.userId, "email");
      email = admin?.email;
    }
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(422).json({ error: "Email de teste inválido" });
    }

    await campaignService.sendTest(campaign, email);
    res.json({ message: `Teste enviado para ${email}` });
  } catch (err) {
    next(err);
  }
};

/**
 * Teste do email preparado no editor de post, antes de salvar/publicar.
 * Recebe os campos do post como estão na tela.
 */
exports.sendPostTest = async (req, res, next) => {
  try {
    if (mailerNotConfigured(res)) return;
    await connectDB();

    const { post = {}, email: rawEmail } = req.body;
    if (!post.title?.trim()) {
      return res.status(422).json({ error: "Preencha o título do post antes de testar" });
    }

    let email = rawEmail;
    if (!email) {
      const admin = await User.findById(req.userId, "email");
      email = admin?.email;
    }
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(422).json({ error: "Email de teste inválido" });
    }

    const campaign = campaignService.campaignFromPost({
      ...post,
      _id: mongoose.isValidObjectId(post._id) ? post._id : undefined,
    });
    // Mostra o botão mesmo antes de publicar, para conferir o visual final
    const postUrl = post.slug ? `${SITE_URL}/blog/${post.slug}` : null;

    await campaignService.sendTest(campaign, email, postUrl);
    res.json({ message: `Teste enviado para ${email}` });
  } catch (err) {
    next(err);
  }
};

// Envia um lote. O painel chama de novo enquanto stats.pending > 0.
exports.send = async (req, res, next) => {
  try {
    if (mailerNotConfigured(res)) return;
    await connectDB();
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Envio não encontrado" });
    if (campaign.status === "sent") {
      return res.json(serialize(campaign, { withRecipients: true }));
    }

    if (campaign.status === "draft") {
      if (!campaign.subject?.trim() || !campaign.content?.trim()) {
        return res.status(422).json({ error: "Preencha assunto e conteúdo antes de enviar" });
      }
      const audienceError = validateAudience(campaign.audience);
      if (audienceError) return res.status(422).json({ error: audienceError });

      const count = await campaignService.countAudience(campaign.audience);
      if (count === 0) {
        return res.status(422).json({ error: "Nenhum assinante ativo neste público" });
      }
    }

    await campaignService.processCampaign(campaign);
    res.json(serialize(campaign, { withRecipients: true }));
  } catch (err) {
    next(err);
  }
};

/**
 * Cria um novo rascunho a partir de um envio existente.
 * mode "copy"        → mesmo público do original
 * mode "new-members" → só membros ativos que ainda não receberam o original
 */
exports.duplicate = async (req, res, next) => {
  try {
    await connectDB();
    const original = await Campaign.findById(req.params.id);
    if (!original) return res.status(404).json({ error: "Envio não encontrado" });

    const { mode = "copy" } = req.body;
    let audience = original.audience.toObject();

    if (mode === "new-members") {
      const received = original.recipients
        .filter((r) => r.status === "sent")
        .map((r) => r.subscriber);

      const members = await Subscriber.find(
        { status: "active", tier: "member", _id: { $nin: received } },
        "_id"
      );
      if (members.length === 0) {
        return res.status(422).json({ error: "Todos os membros ativos já receberam este conteúdo" });
      }
      audience = {
        type: "selected",
        categories: [],
        subscribers: members.map((m) => m._id),
        excludeMembers: false,
      };
    }

    const copy = await Campaign.create({
      subject: original.subject,
      preheader: original.preheader,
      content: original.content,
      post: original.post,
      audience,
    });
    res.status(201).json(serialize(copy));
  } catch (err) {
    next(err);
  }
};

// Volta as falhas para "pendente"; o painel então chama /send em lotes
exports.retryFailed = async (req, res, next) => {
  try {
    if (mailerNotConfigured(res)) return;
    await connectDB();
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Envio não encontrado" });
    if (campaign.status === "draft") {
      return res.status(409).json({ error: "Este envio ainda não foi iniciado" });
    }

    const failed = campaign.recipients.filter((r) => r.status === "failed");
    if (failed.length === 0) {
      return res.status(422).json({ error: "Não há falhas para reenviar" });
    }

    for (const r of failed) {
      r.status = "pending";
      r.error = undefined;
    }
    campaign.status = "sending";
    campaign.sentAt = undefined;
    campaign.markModified("recipients");
    await campaign.save();

    res.json(serialize(campaign, { withRecipients: true }));
  } catch (err) {
    next(err);
  }
};
