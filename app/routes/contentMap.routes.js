const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const connectDB = require("../config/db.config");
const BlogPost = require("../models/blogpost.model");
const { validate } = require("../validation/validate");
const { suggestionsBody } = require("../validation/contentMap.schemas");
const { normalizeTags } = require("../utils/tags");
const { suggestInternalLinks } = require("../services/contentMap.service");

// Sugestões de link interno para o editor (R-MAP-06). POST porque manda o texto
// do editor (rascunho não salvo). Não grava nada. Só admin.
router.post("/suggestions", auth, validate({ body: suggestionsBody }), async (req, res, next) => {
  try {
    await connectDB();
    const { postId, content } = req.body;
    const tags = normalizeTags(req.body.tags);
    res.set("Cache-Control", "no-store");
    if (!tags.length) return res.json({ suggestions: [] });
    const candidates = await BlogPost.find({
      published: true,
      deletedAt: null,
      tags: { $in: tags },
      ...(postId ? { _id: { $ne: postId } } : {}),
    })
      .select("title slug previousSlugs tags publishedAt")
      .lean();
    res.json({ suggestions: suggestInternalLinks({ candidates, tags, content, excludeId: postId }) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
