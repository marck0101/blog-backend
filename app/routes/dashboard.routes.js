const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const connectDB = require("../config/db.config");
const BlogPost = require("../models/blogpost.model");
const Subscriber = require("../models/subscriber.model");
const SearchQuery = require("../models/searchquery.model");
const { isMeaningfulSearch } = require("../utils/sanitize");

const DAY = 24 * 60 * 60 * 1000;
// Rascunho sem mexer há mais que isso aparece como "parado" no dashboard
const STALE_DRAFT_DAYS = 30;

router.get("/stats", auth, async (req, res, next) => {
  try {
    await connectDB();

    // Comparação com o mês anterior (mês do calendário, horário do servidor)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const staleBefore = new Date(Date.now() - STALE_DRAFT_DAYS * DAY);

    const [
      publishedThisMonth,
      publishedLastMonth,
      subscribersThisMonth,
      subscribersLastMonth,
      staleDrafts,
    ] = await Promise.all([
      BlogPost.countDocuments({ published: true, deletedAt: null, publishedAt: { $gte: monthStart } }),
      BlogPost.countDocuments({ published: true, deletedAt: null, publishedAt: { $gte: prevMonthStart, $lt: monthStart } }),
      Subscriber.countDocuments({ createdAt: { $gte: monthStart } }),
      Subscriber.countDocuments({ createdAt: { $gte: prevMonthStart, $lt: monthStart } }),
      BlogPost.countDocuments({ status: "draft", deletedAt: null, updatedAt: { $lt: staleBefore } }),
    ]);

    const [totalPosts, published, drafts, planned, deleted, lastPostArr, totalSubscribers, activeSubscribers] = await Promise.all([
      BlogPost.countDocuments({ deletedAt: null }),
      BlogPost.countDocuments({ published: true, deletedAt: null }),
      // Agendado também tem published false: conta separado do rascunho
      BlogPost.countDocuments({ published: false, status: { $ne: "planned" }, deletedAt: null }),
      BlogPost.countDocuments({ published: false, status: "planned", deletedAt: null }),
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
      planned,
      deleted,
      staleDrafts,
      staleDraftDays: STALE_DRAFT_DAYS,
      publishedThisMonth,
      publishedLastMonth,
      subscribersThisMonth,
      subscribersLastMonth,
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
    const since = new Date(Date.now() - days * DAY);

    const [topPosts, topSearchTerms] = await Promise.all([
      BlogPost.find({ published: true, deletedAt: null })
        .sort({ views: -1 })
        .limit(10)
        .select("title slug category views publishedAt"),

      SearchQuery.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$term", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 60 },
        { $project: { _id: 0, term: "$_id", count: 1 } },
      ]),
    ]);

    // Termos antigos gravados antes do filtro (sondagens de ReDoS etc.) não aparecem
    res.json({ days, topPosts, topSearchTerms: topSearchTerms.filter((t) => isMeaningfulSearch(t.term)).slice(0, 15) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
