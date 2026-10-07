const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const connectDB = require("../config/db.config");
const BlogPost = require("../models/blogpost.model");
const Subscriber = require("../models/subscriber.model");
const SearchQuery = require("../models/searchquery.model");

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

router.get("/content-performance", auth, async (req, res, next) => {
  try {
    await connectDB();

    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [topPosts, topSearchTerms] = await Promise.all([
      BlogPost.find({ published: true, deletedAt: null })
        .sort({ views: -1 })
        .limit(10)
        .select("title slug category views publishedAt"),

      SearchQuery.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$term", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
        { $project: { _id: 0, term: "$_id", count: 1 } },
      ]),
    ]);

    res.json({ days, topPosts, topSearchTerms });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
