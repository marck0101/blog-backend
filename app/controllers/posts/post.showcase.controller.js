const connectDB = require("../../config/db.config");
const BlogPost = require("../../models/blogpost.model");
const stats = require("../../services/postStats.service");
const { MAX_PINNED } = require("../../config/showcase");

/**
 * Vitrine no painel (R-VIT-01 a 03): fixados, regra de destaque e ranking dos
 * mais lidos da semana. O que o leitor vê da vitrine está em post.public.controller.js.
 */

/**
 * ADMIN - VITRINE: fixados, prévia dos destaques e ranking dos últimos 7 dias
 */
exports.showcase = async (req, res, next) => {
  try {
    await connectDB();
    const fields = "_id title slug coverImage category status published publishedAt pinnedOrder highlight views favorites shares commentsCount";

    const [pinned, highlights, ranking, forcedOrHidden] = await Promise.all([
      BlogPost.find({ deletedAt: null, pinnedOrder: { $ne: null } }).select(fields).sort({ pinnedOrder: 1 }).lean(),
      stats.weeklyHighlights({ fields }),
      stats.viewsSince(stats.HIGHLIGHT_DAYS),
      BlogPost.find({ deletedAt: null, highlight: { $in: ["force", "hide"] } }).select(fields).lean(),
    ]);

    // Ranking: os 20 mais lidos da semana + os que têm regra manual
    const top = ranking.slice(0, 20);
    const viewsOf = new Map(ranking.map((r) => [String(r._id), r.views]));
    const ids = new Set(top.map((r) => String(r._id)));
    forcedOrHidden.forEach((p) => ids.add(String(p._id)));
    const posts = await BlogPost.find({ _id: { $in: [...ids] }, deletedAt: null }).select(fields).lean();
    const highlighted = new Set(highlights.map((h) => String(h.post._id)));

    const rankingRows = posts
      .map((p) => ({
        ...p,
        highlight: p.highlight || "auto",
        views7d: viewsOf.get(String(p._id)) || 0,
        inHighlights: highlighted.has(String(p._id)),
      }))
      .sort((a, b) => b.views7d - a.views7d);

    res.json({
      maxPinned: MAX_PINNED,
      highlightDays: stats.HIGHLIGHT_DAYS,
      pinned: pinned.map((p) => ({ ...p, highlight: p.highlight || "auto" })),
      highlights: highlights.map((h) => ({ ...h.post, highlight: h.post.highlight || "auto", views7d: h.views7d, reason: h.reason })),
      ranking: rankingRows,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * ADMIN - DEFINE OS FIXADOS: body { ids: [id1, id2, id3] } na ordem da vitrine.
 * Lista vazia desafixa todos.
 */
exports.setPinned = async (req, res, next) => {
  try {
    // Formato e limite conferidos pelo esquema (validation/posts.schemas.js)
    const ids = [...new Set(req.body.ids)];

    await connectDB();
    const found = await BlogPost.countDocuments({ _id: { $in: ids }, deletedAt: null });
    if (found !== ids.length) return res.status(422).json({ error: "Post inválido ou na lixeira" });

    await BlogPost.updateMany(
      { pinnedOrder: { $ne: null }, _id: { $nin: ids } },
      { $set: { pinnedOrder: null } },
      { timestamps: false }
    );
    await Promise.all(
      ids.map((id, i) => BlogPost.updateOne({ _id: id }, { $set: { pinnedOrder: i + 1 } }, { timestamps: false }))
    );
    res.json({ ok: true, ids });
  } catch (err) {
    next(err);
  }
};

/**
 * ADMIN - REGRA DO DESTAQUE: body { highlight: "auto" | "force" | "hide" }
 */
exports.setHighlight = async (req, res, next) => {
  try {
    const { highlight } = req.body;

    await connectDB();
    const post = await BlogPost.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { $set: { highlight } },
      { returnDocument: "after", timestamps: false, projection: "_id highlight" }
    );
    if (!post) return res.status(404).json({ error: "Post não encontrado" });
    res.json(post);
  } catch (err) {
    next(err);
  }
};
