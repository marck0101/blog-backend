const connectDB = require("../config/db.config");
const BlogPost = require("../models/blogpost.model");
const SearchQuery = require("../models/searchquery.model");
require("../models/subscriber.model"); // para o populate de emailAudience.subscribers
const { notifyNewPost } = require("../services/campaign.service");

const ALLOWED_CATEGORIES = ["tecnologia", "design", "carreira", "negocios", "marketing", "trafego", "growth"];

// Status do post:
//   draft     = rascunho (pode ter plannedAt: data no calendário editorial)
//   planned   = agendado: pronto, vai ao ar sozinho na data (cron diário)
//   published = no ar
// "Na lixeira" é deletedAt, independente do status.
function effectiveStatus(data, existing) {
  if (data.status) return data.status;
  if (data.published !== undefined) return data.published ? "published" : "draft";
  return existing?.status ?? "draft";
}

function validatePost(data, isCreate, existing = null) {
  if (isCreate || data.title !== undefined) {
    const title = (data.title || "").trim();
    if (title.length < 3)
      return "O título deve ter pelo menos 3 caracteres";
  }

  const status = effectiveStatus(data, existing);

  // Rascunho pode ser só uma ideia; agendado e publicado precisam de conteúdo
  if (status !== "draft") {
    const content = (data.content ?? existing?.content ?? "").trim();
    if (content.length < 10)
      return "O conteúdo deve ter pelo menos 10 caracteres para agendar ou publicar";
  }

  if (status === "planned") {
    const plannedAt = data.plannedAt !== undefined ? data.plannedAt : existing?.plannedAt;
    if (!plannedAt || Number.isNaN(new Date(plannedAt).getTime()))
      return "Informe a data de publicação do post agendado";
  }
  if (isCreate && data.category === undefined) {
    return "A categoria é obrigatória";
  }
  if (data.category !== undefined && !ALLOWED_CATEGORIES.includes(data.category)) {
    return `Categoria inválida. Valores permitidos: ${ALLOWED_CATEGORIES.join(", ")}`;
  }
  return null;
}

/** Sincroniza o campo `published` a partir do `status` */
// Falha no email não pode impedir a publicação do post
async function safeNotify(post) {
  try {
    await notifyNewPost(post);
  } catch (err) {
    console.error("[EMAIL]", err);
  }
}

// Data "YYYY-MM-DD" do formulário → meio-dia UTC: cai no mesmo dia em todos os
// fusos do Brasil (meia-noite UTC apareceria no dia anterior) e fica antes do
// cron diário das 12h UTC.
function normalizePlannedAt(data) {
  if (typeof data.plannedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.plannedAt)) {
    data.plannedAt = `${data.plannedAt}T12:00:00.000Z`;
  }
}

function syncPublished(data) {
  // Suporte a legado: se `status` não veio, deriva do boolean `published`
  if (!data.status && data.published !== undefined) {
    data.status = data.published === true ? "published" : "draft";
  }
  // Atualização parcial (sem status nem published) não mexe na publicação
  if (!data.status) return;

  if (data.status === "published") {
    data.published = true;
    if (!data.publishedAt) data.publishedAt = new Date();
  } else {
    // Rascunho e agendado mantêm a data planejada (calendário)
    data.published = false;
  }
}

/**
 * CREATE
 */
exports.create = async (req, res, next) => {
  try {
    await connectDB();

    const data = req.body;

    const validationError = validatePost(data, true);
    if (validationError) {
      return res.status(422).json({ error: validationError });
    }

    normalizePlannedAt(data);
    syncPublished(data);

    const post = await BlogPost.create(data);

    if (post.status === "published") {
      await safeNotify(post);
    }

    res.status(201).json(post);
  } catch (err) {
    next(err);
  }
};

/**
 * BLOG PÚBLICO - FIND BY ID
 */
exports.findPublicById = async (req, res, next) => {
  try {
    await connectDB();

    const post = await BlogPost.findOne({
      _id: req.params.id,
      published: true,
      deletedAt: null,
    });

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    next(err);
  }
};

/**
 * ADMIN - LIST ALL
 */
exports.findAll = async (req, res, next) => {
  try {
    await connectDB();

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const filter = { deletedAt: null };
    if (req.query.published === "true") filter.published = true;
    if (req.query.published === "false") filter.published = false;
    if (["draft", "planned", "published"].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    if (req.query.categories) {
      const cats = req.query.categories.split(",").map((s) => s.trim()).filter(Boolean);
      if (cats.length) filter.category = { $in: cats };
    }

    if (req.query.search) {
      filter.title = { $regex: req.query.search.trim(), $options: "i" };
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

    const [posts, total] = await Promise.all([
      BlogPost.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      BlogPost.countDocuments(filter),
    ]);

    res.json({ posts, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

/**
 * BLOG PÚBLICO - LIST PUBLISHED
 */
exports.findAllPublished = async (req, res, next) => {
  try {
    await connectDB();

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const filter = { published: true, deletedAt: null };

    if (req.query.categories) {
      const cats = req.query.categories.split(",").map((s) => s.trim()).filter(Boolean);
      if (cats.length) filter.category = { $in: cats };
    }

    if (req.query.search) {
      const term = req.query.search.trim();
      filter.title = { $regex: term, $options: "i" };

      // Log best-effort — não deve atrapalhar a busca se falhar.
      if (term.length >= 2) {
        SearchQuery.create({ term }).catch(() => {});
      }
    }

    if (req.query.dateFrom || req.query.dateTo) {
      filter.publishedAt = {};
      if (req.query.dateFrom) filter.publishedAt.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) {
        const to = new Date(req.query.dateTo);
        to.setHours(23, 59, 59, 999);
        filter.publishedAt.$lte = to;
      }
    }

    const [posts, total] = await Promise.all([
      BlogPost.find(filter)
        .sort({ publishedAt: -1 })
        .skip(skip)
        .limit(limit),
      BlogPost.countDocuments(filter),
    ]);

    res.json({ posts, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

/**
 * BLOG PÚBLICO - FIND BY SLUG
 */
exports.findBySlug = async (req, res, next) => {
  try {
    await connectDB();

    const post = await BlogPost.findOneAndUpdate(
      { slug: req.params.slug, published: true, deletedAt: null },
      { $inc: { views: 1 } },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    next(err);
  }
};

/**
 * ADMIN - FIND ONE
 */
exports.findOne = async (req, res, next) => {
  try {
    await connectDB();

    const post = await BlogPost.findById(req.params.id).populate(
      "emailAudience.subscribers",
      "name email tier"
    );

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    next(err);
  }
};

/**
 * UPDATE
 */
exports.update = async (req, res, next) => {
  try {
    await connectDB();

    const data = req.body;

    const existing = await BlogPost.findById(req.params.id)
      .select("status publishedAt plannedAt content")
      .lean();

    const validationError = validatePost(data, false, existing);
    if (validationError) {
      return res.status(422).json({ error: validationError });
    }

    // Preserva publishedAt existente ao publicar
    if (data.status === "published" && !data.publishedAt && existing?.publishedAt) {
      data.publishedAt = existing.publishedAt;
    }

    normalizePlannedAt(data);
    syncPublished(data);

    const post = await BlogPost.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true,
    });

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    if (post.status === "published" && existing?.status !== "published") {
      await safeNotify(post);
    }

    res.json(post);
  } catch (err) {
    next(err);
  }
};

/**
 * SOFT DELETE
 */
exports.softDelete = async (req, res, next) => {
  try {
    await connectDB();

    const post = await BlogPost.findByIdAndUpdate(
      req.params.id,
      { deletedAt: new Date() },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    next(err);
  }
};

/**
 * RESTORE
 */
exports.restore = async (req, res, next) => {
  try {
    await connectDB();

    const post = await BlogPost.findByIdAndUpdate(
      req.params.id,
      { deletedAt: null },
      { new: true }
    );

    // Agendado com data já passada voltaria ao ar sozinho no próximo cron
    if (post && post.status === "planned" && post.plannedAt && post.plannedAt < new Date()) {
      post.status = "draft";
      await post.save();
    }

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    next(err);
  }
};

/**
 * LIST TRASH
 */
exports.findAllDeleted = async (req, res, next) => {
  try {
    await connectDB();

    const posts = await BlogPost.find({
      deletedAt: { $ne: null },
    }).sort({ deletedAt: -1 });

    res.json(posts);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE PERMANENT
 */
exports.deletePermanent = async (req, res, next) => {
  try {
    await connectDB();

    const post = await BlogPost.findByIdAndDelete(req.params.id);

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json({ message: "Post removido definitivamente" });
  } catch (err) {
    next(err);
  }
};

/**
 * CALENDAR — posts do mês com plannedAt ou publishedAt
 */
exports.calendar = async (req, res, next) => {
  try {
    await connectDB();

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const posts = await BlogPost.find({
      deletedAt: null,
      $or: [
        { plannedAt: { $gte: start, $lte: end } },
        { publishedAt: { $gte: start, $lte: end } },
        { createdAt: { $gte: start, $lte: end }, status: "draft" },
      ],
    })
      .select("_id title slug status plannedAt publishedAt createdAt")
      .sort({ plannedAt: 1, publishedAt: 1, createdAt: 1 });

    res.json(posts);
  } catch (err) {
    next(err);
  }
};

/**
 * HEATMAP — contagem de publicações por dia no ano
 */
exports.heatmap = async (req, res, next) => {
  try {
    await connectDB();

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);

    const posts = await BlogPost.find({
      published: true,
      deletedAt: null,
      publishedAt: { $gte: start, $lte: end },
    })
      .select("publishedAt")
      .lean();

    const result = {};
    posts.forEach((p) => {
      const d = new Date(p.publishedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      result[key] = (result[key] || 0) + 1;
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
};

/**
 * TODAY PLANNED — posts planejados para hoje
 */
exports.todayPlanned = async (req, res, next) => {
  try {
    await connectDB();

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const posts = await BlogPost.find({
      status: "planned",
      deletedAt: null,
      plannedAt: { $gte: start, $lte: end },
    })
      .select("_id title slug plannedAt")
      .lean();

    res.json(posts);
  } catch (err) {
    next(err);
  }
};

/**
 * REMOVE IMAGE
 */
exports.removeImage = async (req, res, next) => {
  try {
    await connectDB();

    const { imageUrl } = req.body;

    const post = await BlogPost.findByIdAndUpdate(
      req.params.id,
      { $pull: { gallery: { url: imageUrl } } },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    next(err);
  }
};
