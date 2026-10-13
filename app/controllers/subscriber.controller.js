const connectDB = require("../config/db.config");
const Subscriber = require("../models/subscriber.model");
const CATEGORIES = require("../config/categories");
const { recordUnsubscribe } = require("../services/tracking.service");

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

exports.findAll = async (req, res, next) => {
  try {
    await connectDB();

    const {
      status,
      page: rawPage = 1,
      limit: rawLimit = 20,
    } = req.query;

    const page = Math.max(1, parseInt(rawPage));
    const limit = Math.min(100, Math.max(1, parseInt(rawLimit)));
    const skip = (page - 1) * limit;

    const filter = {};
    if (status) filter.status = status;
    if (req.query.tier) filter.tier = req.query.tier;

    if (req.query.categories) {
      const cats = req.query.categories.split(",").map((s) => s.trim()).filter(Boolean);
      if (cats.length) filter.categories = { $in: cats };
    }

    if (req.query.search) {
      const regex = { $regex: req.query.search.trim(), $options: "i" };
      filter.$or = [{ name: regex }, { email: regex }];
    }

    if (req.query.dateFrom || req.query.dateTo) {
      filter.createdAt = {};
      if (req.query.dateFrom) filter.createdAt.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) {
        const to = new Date(req.query.dateTo);
        to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }

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
