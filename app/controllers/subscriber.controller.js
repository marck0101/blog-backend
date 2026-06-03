const connectDB = require("../config/db.config");
const Subscriber = require("../models/subscriber.model");
const CATEGORIES = require("../config/categories");

const VALID_SLUGS = CATEGORIES.map((c) => c.slug);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.subscribe = async (req, res, next) => {
  try {
    await connectDB();

    const { email, name, categories = [] } = req.body;

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
        return res.status(409).json({ error: "Email já cadastrado" });
      }
      existing.status = "active";
      existing.categories = categories;
      if (name) existing.name = name;
      existing.confirmedAt = new Date();
      await existing.save();
      return res.status(200).json({ message: "Inscrição reativada com sucesso!" });
    }

    await Subscriber.create({ email, name, categories });
    res.status(201).json({ message: "Inscrição realizada com sucesso!" });
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

    subscriber.status = "unsubscribed";
    await subscriber.save();

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
        .sort({ createdAt: -1 })
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

    const { status, categories } = req.body;
    const patch = {};

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
