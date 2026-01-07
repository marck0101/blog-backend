const BlogPost = require("../models/blogpost.model");

/**
 * CREATE
 */
exports.create = async (req, res) => {
  try {
    const data = req.body;

    if (data.published && !data.publishedAt) {
      data.publishedAt = new Date();
    }

    const post = await BlogPost.create(data);
    res.status(201).json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * ADMIN - LIST ALL (não deletados)
 */
exports.findAll = async (req, res) => {
  try {
    const posts = await BlogPost.find({ deletedAt: null }).sort({
      createdAt: -1,
    });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * BLOG PÚBLICO - LIST PUBLISHED
 */
exports.findAllPublished = async (req, res) => {
  try {
    const posts = await BlogPost.find({
      published: true,
      deletedAt: null,
    }).sort({ publishedAt: -1 });

    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * BLOG PÚBLICO - FIND BY SLUG
 */
exports.findBySlug = async (req, res) => {
  try {
    const post = await BlogPost.findOne({
      slug: req.params.slug,
      published: true,
      deletedAt: null,
    });

    if (!post) {
      return res.status(404).json({ message: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * ADMIN - FIND ONE
 */
exports.findOne = async (req, res) => {
  try {
    const post = await BlogPost.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ message: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * UPDATE
 */
exports.update = async (req, res) => {
  try {
    const data = req.body;

    if (data.published === true && !data.publishedAt) {
      data.publishedAt = new Date();
    }

    if (data.published === false) {
      data.publishedAt = null;
    }

    const post = await BlogPost.findByIdAndUpdate(
      req.params.id,
      data,
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ message: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * SOFT DELETE (LIXEIRA)
 */
exports.softDelete = async (req, res) => {
  try {
    const post = await BlogPost.findByIdAndUpdate(
      req.params.id,
      { deletedAt: new Date() },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ message: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * RESTORE FROM TRASH
 */
exports.restore = async (req, res) => {
  try {
    const post = await BlogPost.findByIdAndUpdate(
      req.params.id,
      { deletedAt: null },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ message: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * LIST TRASH
 */
exports.findAllDeleted = async (req, res) => {
  try {
    const posts = await BlogPost.find({
      deletedAt: { $ne: null },
    }).sort({ deletedAt: -1 });

    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * DELETE PERMANENT
 */
exports.deletePermanent = async (req, res) => {
  try {
    const post = await BlogPost.findByIdAndDelete(req.params.id);

    if (!post) {
      return res.status(404).json({ message: "Post não encontrado" });
    }

    res.json({ message: "Post removido definitivamente" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * REMOVE IMAGE FROM GALLERY
 */
exports.removeImage = async (req, res) => {
  try {
    const { imageUrl } = req.body;

    const post = await BlogPost.findByIdAndUpdate(
      req.params.id,
      {
        $pull: { gallery: { url: imageUrl } },
      },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ message: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
