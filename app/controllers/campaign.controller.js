const mongoose = require("mongoose");
const connectDB = require("../config/db.config");
const Campaign = require("../models/campaign.model");
const User = require("../models/user.model");
const CATEGORIES = require("../config/categories");
const Subscriber = require("../models/subscriber.model");
const campaignService = require("../services/campaign.service");

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

function pickEditable(body) {
  const data = {};
  for (const key of ["subject", "preheader", "content", "audience"]) {
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
    const campaigns = await Campaign.find().sort({ createdAt: -1 });
    res.json(campaigns.map((c) => serialize(c)));
  } catch (err) {
    next(err);
  }
};

exports.findOne = async (req, res, next) => {
  try {
    await connectDB();
    const campaign = await Campaign.findById(req.params.id).populate(
      "audience.subscribers",
      "name email tier"
    );
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

    const audienceError = validateAudience(data.audience);
    if (audienceError) return res.status(422).json({ error: audienceError });

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
    const audienceError = validateAudience(data.audience);
    if (audienceError) return res.status(422).json({ error: audienceError });

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
    if (audienceError) return res.json({ count: 0 });

    const count = await campaignService.countAudience(req.body.audience);
    res.json({ count });
  } catch (err) {
    next(err);
  }
};

exports.sendTest = async (req, res, next) => {
  try {
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

// Envia um lote. O painel chama de novo enquanto stats.pending > 0.
exports.send = async (req, res, next) => {
  try {
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
      audience = { type: "selected", categories: [], subscribers: members.map((m) => m._id) };
    }

    const copy = await Campaign.create({
      subject: original.subject,
      preheader: original.preheader,
      content: original.content,
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
