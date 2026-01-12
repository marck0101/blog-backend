const connectDB = require("../config/db.config");
const BlogPost = require("../models/blogpost.model");

/**
 * CREATE
 */
exports.create = async (req, res) => {
  try {
    await connectDB();

    const data = req.body;

    if (data.published && !data.publishedAt) {
      data.publishedAt = new Date();
    }

    const post = await BlogPost.create(data);
    res.status(201).json(post);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * BLOG PÚBLICO - FIND BY ID
 */
exports.findPublicById = async (req, res) => {
  try {
    await connectDB();

    const post = await BlogPost.findOne({
      _id: req.params.id,
      published: true,
      deletedAt: null,
    });

    if (!post) {
      return res.status(404).json({ message: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * ADMIN - LIST ALL
 */
exports.findAll = async (req, res) => {
  try {
    await connectDB();

    const posts = await BlogPost.find({ deletedAt: null }).sort({
      createdAt: -1,
    });

    res.json(posts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * BLOG PÚBLICO - LIST PUBLISHED
 */
exports.findAllPublished = async (req, res) => {
  try {
    await connectDB();

    const posts = await BlogPost.find({
      published: true,
      deletedAt: null,
    }).sort({ publishedAt: -1 });

    res.json(posts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * BLOG PÚBLICO - FIND BY SLUG
 */
exports.findBySlug = async (req, res) => {
  try {
    await connectDB();

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
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * ADMIN - FIND ONE
 */
exports.findOne = async (req, res) => {
  try {
    await connectDB();

    const post = await BlogPost.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ message: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * UPDATE
 */
exports.update = async (req, res) => {
  try {
    await connectDB();

    const data = req.body;

    if (data.published === true && !data.publishedAt) {
      data.publishedAt = new Date();
    }

    if (data.published === false) {
      data.publishedAt = null;
    }

    const post = await BlogPost.findByIdAndUpdate(req.params.id, data, {
      new: true,
    });

    if (!post) {
      return res.status(404).json({ message: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * SOFT DELETE
 */
exports.softDelete = async (req, res) => {
  try {
    await connectDB();

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
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * RESTORE
 */
exports.restore = async (req, res) => {
  try {
    await connectDB();

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
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * LIST TRASH
 */
exports.findAllDeleted = async (req, res) => {
  try {
    await connectDB();

    const posts = await BlogPost.find({
      deletedAt: { $ne: null },
    }).sort({ deletedAt: -1 });

    res.json(posts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * DELETE PERMANENT
 */
exports.deletePermanent = async (req, res) => {
  try {
    await connectDB();

    const post = await BlogPost.findByIdAndDelete(req.params.id);

    if (!post) {
      return res.status(404).json({ message: "Post não encontrado" });
    }

    res.json({ message: "Post removido definitivamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * REMOVE IMAGE
 */
exports.removeImage = async (req, res) => {
  try {
    await connectDB();

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
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};
