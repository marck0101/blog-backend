const connectDB = require("../config/db.config");
const BlogPost = require("../models/blogpost.model");

const ALLOWED_CATEGORIES = ["marketing", "trafego", "growth", "tecnologia"];

function validatePost(data, isCreate) {
  if (isCreate || data.title !== undefined) {
    const title = (data.title || "").trim();
    if (title.length < 3)
      return "O título deve ter pelo menos 3 caracteres";
  }
  // Posts planejados não precisam de conteúdo
  const isPlanned = data.status === "planned";
  if (!isPlanned && (isCreate || data.content !== undefined)) {
    const content = (data.content || "").trim();
    if (content.length < 10)
      return "O conteúdo deve ter pelo menos 10 caracteres";
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
function syncPublished(data) {
  // Suporte a legado: se `status` não veio, deriva do boolean `published`
  if (!data.status) {
    data.status = data.published === true ? "published" : "draft";
  }
  if (data.status === "published") {
    data.published = true;
    if (!data.publishedAt) data.publishedAt = new Date();
  } else {
    data.published = false;
    if (data.status !== "planned") data.plannedAt = null;
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

    syncPublished(data);

    const post = await BlogPost.create(data);
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
      filter.title = { $regex: req.query.search.trim(), $options: "i" };
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

    const post = await BlogPost.findOne({
      slug: req.params.slug,
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
 * ADMIN - FIND ONE
 */
exports.findOne = async (req, res, next) => {
  try {
    await connectDB();

    const post = await BlogPost.findById(req.params.id);

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

    const validationError = validatePost(data, false);
    if (validationError) {
      return res.status(422).json({ error: validationError });
    }

    // Preserva publishedAt existente ao publicar
    if (data.status === "published" && !data.publishedAt) {
      const existing = await BlogPost.findById(req.params.id).select("publishedAt").lean();
      if (existing?.publishedAt) data.publishedAt = existing.publishedAt;
    }

    syncPublished(data);

    const post = await BlogPost.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true,
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
