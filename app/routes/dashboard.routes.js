const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const connectDB = require("../config/db.config");
const BlogPost = require("../models/blogpost.model");
const Subscriber = require("../models/subscriber.model");

router.get("/stats", auth, async (req, res, next) => {
  try {
    await connectDB();

    const [totalPosts, published, drafts, deleted, lastPostArr, totalSubscribers, activeSubscribers] = await Promise.all([
      BlogPost.countDocuments({ deletedAt: null }),
      BlogPost.countDocuments({ published: true, deletedAt: null }),
      BlogPost.countDocuments({ published: false, deletedAt: null }),
      BlogPost.countDocuments({ deletedAt: { $ne: null } }),
      BlogPost.find({ published: true, deletedAt: null })
        .sort({ publishedAt: -1 })
        .limit(1)
        .select("title publishedAt slug"),
      Subscriber.countDocuments({}),
      Subscriber.countDocuments({ status: "active" }),
    ]);

    res.json({
      totalPosts,
      published,
      drafts,
      deleted,
      lastPost: lastPostArr[0] || null,
      totalSubscribers,
      activeSubscribers,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
