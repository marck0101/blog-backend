const mongoose = require("mongoose");
const connectDB = require("../config/db.config");
const Subscriber = require("../models/subscriber.model");
const Campaign = require("../models/campaign.model");

// O que fica no lugar do email de quem foi excluído, no histórico dos envios
const REMOVED_EMAIL = "(removido)";
const { recordUnsubscribe } = require("../services/tracking.service");
const { str, escapeRegex } = require("../utils/sanitize");
const { COLLATION_PT, pickSort, sortedFind } = require("../utils/listSort");
const limiter = require("../services/ratelimit.service");
const { FRONTEND_URL } = require("../config/urls");
const { dayRangeFilter } = require("../utils/dates");
const { categoriesError } = require("../utils/validators");

// Rota pública sem login: 5 inscrições por IP a cada 30 min. Barra script
// cadastrando emails de terceiros em massa (que depois receberiam os envios).
const SUBSCRIBE_MAX = 5;
const SUBSCRIBE_WINDOW_MIN = 30;

// O formato de cada rota (tipos, tamanhos, campos permitidos) é conferido antes,
// pelo esquema: app/validation/subscribers.schemas.js. Aqui ficam as regras.

// Mesma resposta para email novo e já inscrito: a rota pública não pode
// revelar quem é assinante (um pentester testaria emails um a um).
const SUBSCRIBED = { message: "Inscrição realizada com sucesso!" };

exports.subscribe = async (req, res, next) => {
  try {
    await connectDB();

    const wait = await limiter.blockedFor("subscribe", req, SUBSCRIBE_MAX);
    if (wait) return limiter.tooMany(res, wait);
    await limiter.hit("subscribe", req, SUBSCRIBE_WINDOW_MIN);

    const { email, name, categories, source } = req.body;
    const categoryError = categoriesError(categories);
    if (categoryError) return res.status(422).json({ error: categoryError });

    const existing = await Subscriber.findOne({
      email: email.toLowerCase().trim(),
    });

    if (existing) {
      if (existing.status === "active") {
        // Não altera nada de quem já é assinante (nem categorias) e não revela que existe
        return res.status(201).json(SUBSCRIBED);
      }
      existing.status = "active";
      existing.categories = categories;
      if (name) existing.name = name;
      existing.confirmedAt = new Date();
      existing.unsubscribedAt = null;
      existing.unsubscribeCampaign = null;
      if (source) existing.source = source;
      await existing.save();
      return res.status(201).json(SUBSCRIBED);
    }

    await Subscriber.create({ email, name, categories, source });
    res.status(201).json(SUBSCRIBED);
  } catch (err) {
    next(err);
  }
};

// Cadastro feito pelo admin (ex.: alguém que virou membro fora do formulário)
exports.createManual = async (req, res, next) => {
  try {
    await connectDB();

    const { email, name, categories, tier, notes } = req.body;
    const categoryError = categoriesError(categories);
    if (categoryError) return res.status(422).json({ error: categoryError });

    const subscriber = await Subscriber.create({
      email,
      name,
      categories,
      tier,
      notes,
      memberSince: tier === "member" ? new Date() : null,
      source: { location: "manual" },
    });

    const { token, ...data } = subscriber.toObject();
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
};

const campaignParam = (value) => (typeof value === "string" && /^[a-f0-9]{24}$/.test(value) ? value : null);

/**
 * GET do link de cancelar (rodapé do email e cabeçalho List-Unsubscribe).
 * Não altera nada: antivírus de email abrem todos os links ao receber, e
 * cancelariam a inscrição de quem nem viu o email. Leva à página de
 * confirmação no blog, com o token depois do # (o navegador não envia essa
 * parte a nenhum servidor; a página tira da barra de endereço ao abrir).
 */
exports.unsubscribePage = (req, res) => {
  const params = new URLSearchParams({ t: str(req.params.token) });
  const campaign = campaignParam(req.query.c);
  if (campaign) params.set("c", campaign);
  res.set("Cache-Control", "no-store");
  res.redirect(302, `${FRONTEND_URL}/cancelar-inscricao#${params}`);
};

/**
 * POST: cancela. Vem do botão da página de confirmação ou do "cancelar
 * inscrição" do próprio Gmail/Yahoo (RFC 8058, corpo List-Unsubscribe=One-Click).
 * O token secreto (64 hex) é a autorização.
 */
exports.unsubscribe = async (req, res, next) => {
  try {
    await connectDB();

    const token = str(req.params.token);
    const subscriber = /^[a-f0-9]{64}$/.test(token) ? await Subscriber.findOne({ token }) : null;

    if (!subscriber) {
      return res.status(404).json({ error: "Token inválido ou não encontrado" });
    }

    // Link repetido não conta duas vezes nem muda a data da saída
    if (subscriber.status !== "unsubscribed") {
      subscriber.status = "unsubscribed";
      subscriber.unsubscribedAt = new Date();
      const campaign = campaignParam(req.query.c) || campaignParam(req.body.c);
      if (campaign) {
        subscriber.unsubscribeCampaign = campaign;
        await recordUnsubscribe(campaign, subscriber._id).catch((err) =>
          console.error("[TRACK] unsubscribe:", err.message)
        );
      }
      await subscriber.save();
    }

    res.json({ message: "Inscrição cancelada com sucesso." });
  } catch (err) {
    next(err);
  }
};

// Ordem da lista de assinantes (?sort=); a primeira é a padrão.
// Nome vazio vai para o fim no A-Z.
const LIST_SORTS = {
  recent: { sort: { createdAt: -1, _id: -1 } },
  oldest: { sort: { createdAt: 1, _id: 1 } },
  name: { sort: { name: 1, email: 1, _id: 1 }, collation: COLLATION_PT, emptyLast: "name" },
  name_desc: { sort: { name: -1, email: 1, _id: 1 }, collation: COLLATION_PT, emptyLast: "name" },
  email: { sort: { email: 1, _id: 1 }, collation: COLLATION_PT },
  email_desc: { sort: { email: -1, _id: -1 }, collation: COLLATION_PT },
  // Plano: membros primeiro (mais antigos como membro no topo) ou gratuitos primeiro
  tier: {
    addFields: { _freeFirst: { $cond: [{ $eq: ["$tier", "member"] }, 0, 1] } },
    sort: { _freeFirst: 1, memberSince: 1, createdAt: -1, _id: -1 },
  },
  tier_free: {
    addFields: { _freeFirst: { $cond: [{ $eq: ["$tier", "member"] }, 1, 0] } },
    sort: { _freeFirst: 1, createdAt: -1, _id: -1 },
  },
  // Status: ativos primeiro (o inverso é "Cancelados recentemente")
  active: {
    addFields: { _activeLast: { $cond: [{ $eq: ["$status", "active"] }, 0, 1] } },
    sort: { _activeLast: 1, createdAt: -1, _id: -1 },
  },
  // Cancelados primeiro (mesmo os antigos, sem data de cancelamento), depois ativos
  unsubscribed: {
    addFields: { _activeLast: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
    sort: { _activeLast: 1, unsubscribedAt: -1, updatedAt: -1, _id: -1 },
  },
};
const listOrder = (query) => LIST_SORTS[pickSort(LIST_SORTS, query.sort)];

// Filtros da lista de assinantes (lista paginada e exportação CSV)
function listFilter(query) {
  const filter = {};
  const status = str(query.status);
  const tier = str(query.tier);
  if (status) filter.status = status;
  if (tier) filter.tier = tier;

  // Público nomeado (?list=<id>)
  const list = str(query.list);
  if (mongoose.isValidObjectId(list)) filter.lists = list;

  const categories = str(query.categories);
  if (categories) {
    const cats = categories.split(",").map((s) => s.trim()).filter(Boolean);
    if (cats.length) filter.categories = { $in: cats };
  }

  // Texto literal: "(a+)+$" não vira expressão regular
  const search = str(query.search);
  if (search) {
    const regex = { $regex: escapeRegex(search), $options: "i" };
    filter.$or = [{ name: regex }, { email: regex }];
  }

  const createdAt = dayRangeFilter(query.dateFrom, query.dateTo);
  if (createdAt) filter.createdAt = createdAt;
  return filter;
}

// Célula CSV: aspas escapadas e sem fórmula (=, +, -, @ no início viram texto
// no Excel/Sheets — um nome "=HYPERLINK(...)" não executa nada)
function csvCell(value) {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const csvDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/**
 * ADMIN — exporta assinantes (com os mesmos filtros da lista) em CSV.
 * Separador ";" e BOM UTF-8: abre direto no Excel em português.
 */
exports.exportCsv = async (req, res, next) => {
  try {
    await connectDB();
    const subscribers = await sortedFind(Subscriber, listFilter(req.query), listOrder(req.query), { exclude: ["token"] });

    const header = [
      "email", "nome", "status", "plano", "categorias", "inscrito_em", "cancelado_em",
      "membro_desde", "origem", "pagina", "utm_source", "utm_medium", "utm_campaign", "anotacao",
    ];
    const rows = subscribers.map((s) => [
      s.email, s.name, s.status === "active" ? "ativo" : "cancelado", s.tier === "member" ? "membro" : "gratuito",
      (s.categories || []).join(", "), csvDate(s.createdAt), csvDate(s.unsubscribedAt), csvDate(s.memberSince),
      s.source?.location, s.source?.path, s.source?.utmSource, s.source?.utmMedium, s.source?.utmCampaign, s.notes,
    ]);

    const csv = [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
    const date = new Date().toISOString().slice(0, 10);
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="assinantes-${date}.csv"`,
      "Cache-Control": "no-store",
    });
    res.send("\uFEFF" + csv);
  } catch (err) {
    next(err);
  }
};

exports.findAll = async (req, res, next) => {
  try {
    await connectDB();

    const {
      page: rawPage = 1,
      limit: rawLimit = 20,
    } = req.query;

    const page = Math.max(1, parseInt(rawPage) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(rawLimit) || 20));
    const skip = (page - 1) * limit;

    const filter = listFilter(req.query);

    const [subscribers, total] = await Promise.all([
      sortedFind(Subscriber, filter, listOrder(req.query), { skip, limit, exclude: ["token"] }),
      Subscriber.countDocuments(filter),
    ]);

    res.json({ subscribers, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    await connectDB();

    const subscriber = await Subscriber.findByIdAndDelete(req.params.id);
    if (!subscriber) {
      return res.status(404).json({ error: "Assinante não encontrado" });
    }

    // R-SUB-07 (LGPD): o email também sai do histórico dos envios que a pessoa
    // recebeu. A linha continua lá, então entregas, aberturas e cliques não mudam.
    await Campaign.updateMany(
      { "recipients.subscriber": subscriber._id },
      { $set: { "recipients.$[person].email": REMOVED_EMAIL } },
      { arrayFilters: [{ "person.subscriber": subscriber._id }], timestamps: false }
    );

    res.json({ message: "Assinante removido com sucesso" });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    await connectDB();

    const { categories, tier, ...rest } = req.body;
    if (categories !== undefined) {
      const categoryError = categoriesError(categories);
      if (categoryError) return res.status(422).json({ error: categoryError });
    }

    // name, notes, status como vieram; plano novo reinicia o "membro desde" (R-SUB-05)
    const patch = { ...rest };
    if (categories !== undefined) patch.categories = categories;
    if (tier !== undefined) {
      patch.tier = tier;
      patch.memberSince = tier === "member" ? new Date() : null;
    }

    const subscriber = await Subscriber.findByIdAndUpdate(
      req.params.id,
      patch,
      { new: true, select: "-token" }
    );

    if (!subscriber) {
      return res.status(404).json({ error: "Assinante não encontrado" });
    }

    res.json(subscriber);
  } catch (err) {
    next(err);
  }
};
