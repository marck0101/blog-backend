const connectDB = require("../config/db.config");
const BlogPost = require("../models/blogpost.model");

const ALLOWED_CATEGORIES = ["marketing", "trafego", "growth", "tecnologia"];

function validatePost(data, isCreate) {
  if (isCreate || data.title !== undefined) {
    const title = (data.title || "").trim();
    if (title.length < 3)
      return "O título deve ter pelo menos 3 caracteres";
  }
  if (isCreate || data.content !== undefined) {
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

    if (data.published && !data.publishedAt) {
      data.publishedAt = new Date();
    }

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

    const [posts, total] = await Promise.all([
      BlogPost.find({ deletedAt: null })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      BlogPost.countDocuments({ deletedAt: null }),
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

    if (data.published === true && !data.publishedAt) {
      data.publishedAt = new Date();
    }

    if (data.published === false) {
      data.publishedAt = null;
    }

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
