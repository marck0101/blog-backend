const mongoose = require("mongoose");
const connectDB = require("../config/db.config");
const Subscriber = require("../models/subscriber.model");
const CATEGORIES = require("../config/categories");
const { recordUnsubscribe } = require("../services/tracking.service");
const { str, escapeRegex } = require("../utils/sanitize");
const limiter = require("../services/ratelimit.service");

// Rota pública sem login: 5 inscrições por IP a cada 30 min. Barra script
// cadastrando emails de terceiros em massa (que depois receberiam os envios).
const SUBSCRIBE_MAX = 5;
const SUBSCRIBE_WINDOW_MIN = 30;

const VALID_SLUGS = CATEGORIES.map((c) => c.slug);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIERS = ["free", "member"];

// Origem enviada pelo formulário do blog: só texto curto, campos conhecidos
const SOURCE_FIELDS = ["location", "path", "post", "landingPath", "referrer", "utmSource", "utmMedium", "utmCampaign"];
function pickSource(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const source = {};
  for (const field of SOURCE_FIELDS) {
    if (typeof raw[field] === "string") source[field] = raw[field].trim().slice(0, 200);
  }
  return source;
}

// Mesma resposta para email novo e já inscrito: a rota pública não pode
// revelar quem é assinante (um pentester testaria emails um a um).
const SUBSCRIBED = { message: "Inscrição realizada com sucesso!" };

exports.subscribe = async (req, res, next) => {
  try {
    await connectDB();

    const wait = await limiter.blockedFor("subscribe", req, SUBSCRIBE_MAX);
    if (wait) return limiter.tooMany(res, wait);
    await limiter.hit("subscribe", req, SUBSCRIBE_WINDOW_MIN);

    // Só tipos esperados: objetos virariam operadores do MongoDB
    const email = typeof req.body?.email === "string" ? req.body.email.trim().slice(0, 254) : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 100) : undefined;
    const categories = Array.isArray(req.body?.categories) ? req.body.categories : [];
    const source = pickSource(req.body?.source);

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(422).json({ error: "Email inválido" });
    }

    const invalidCats = categories.filter((c) => !VALID_SLUGS.includes(c));
    if (invalidCats.length > 0) {
      return res
        .status(422)
        .json({ error: `Categorias inválidas: ${invalidCats.join(", ")}` });
    }

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

    const { email, name, categories = [], tier = "free", notes } = req.body;

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(422).json({ error: "Email inválido" });
    }
    if (!TIERS.includes(tier)) {
      return res.status(422).json({ error: "Plano inválido" });
    }
    const invalidCats = categories.filter((c) => !VALID_SLUGS.includes(c));
    if (invalidCats.length > 0) {
      return res
        .status(422)
        .json({ error: `Categorias inválidas: ${invalidCats.join(", ")}` });
    }

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

exports.unsubscribe = async (req, res, next) => {
  try {
    await connectDB();

    const subscriber = await Subscriber.findOne({ token: req.params.token });

    if (!subscriber) {
      return res.status(404).json({ error: "Token inválido ou não encontrado" });
    }

    // Link repetido não conta duas vezes nem muda a data da saída
    if (subscriber.status !== "unsubscribed") {
      subscriber.status = "unsubscribed";
      subscriber.unsubscribedAt = new Date();
      if (req.query.c && /^[a-f0-9]{24}$/.test(req.query.c)) {
        subscriber.unsubscribeCampaign = req.query.c;
        await recordUnsubscribe(req.query.c, subscriber._id).catch((err) =>
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

  const dateFrom = str(query.dateFrom);
  const dateTo = str(query.dateTo);
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }
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
    const subscribers = await Subscriber.find(listFilter(req.query), "-token")
      .sort({ createdAt: -1, _id: -1 })
      .lean();

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
      Subscriber.find(filter, "-token")
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
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

    res.json({ message: "Assinante removido com sucesso" });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    await connectDB();

    const { status, categories, tier, notes, name } = req.body;
    const patch = {};

    if (name !== undefined) patch.name = String(name).trim();

    if (tier !== undefined) {
      if (!TIERS.includes(tier)) {
        return res.status(422).json({ error: "Plano inválido" });
      }
      patch.tier = tier;
      patch.memberSince = tier === "member" ? new Date() : null;
    }

    if (notes !== undefined) patch.notes = String(notes).trim();

    if (status !== undefined) {
      if (!["active", "unsubscribed"].includes(status)) {
        return res.status(422).json({ error: "Status inválido" });
      }
      patch.status = status;
    }

    if (categories !== undefined) {
      const invalidCats = categories.filter((c) => !VALID_SLUGS.includes(c));
      if (invalidCats.length > 0) {
        return res
          .status(422)
          .json({ error: `Categorias inválidas: ${invalidCats.join(", ")}` });
      }
      patch.categories = categories;
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
