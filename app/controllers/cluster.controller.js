const connectDB = require("../config/db.config");
const BlogPost = require("../models/blogpost.model");
const CLUSTERS = require("../config/clusters");
const { str } = require("../utils/sanitize");
const { withReadingMinutes } = require("../utils/readingTime");

/**
 * Temas (clusters) públicos — R-CLU-01..03.
 * A lista é fixa (app/config/clusters.js); a página de um tema só existe
 * quando ele tem pelo menos um post publicado.
 */

const PUBLISHED = { published: true, deletedAt: null };
// Cards do tema (content só para o tempo de leitura; não vai na resposta)
const CLUSTER_POST_FIELDS =
  "_id title slug excerpt directAnswer coverImage coverImageAlt category cluster isPillar publishedAt updatedAt readingMinutes content";

/** Posts publicados por tema: Map slug → quantidade */
async function publishedCounts() {
  const counts = await BlogPost.aggregate([
    { $match: { ...PUBLISHED, cluster: { $ne: null } } },
    { $group: { _id: "$cluster", n: { $sum: 1 } } },
  ]);
  return new Map(counts.map((c) => [c._id, c.n]));
}

/** GET /api/clusters — a lista fixa (painel e front); ?withCounts=1 só os temas com post */
exports.list = async (req, res, next) => {
  try {
    res.set("Cache-Control", "public, max-age=300, s-maxage=600");
    if (req.query.withCounts !== "1") return res.json(CLUSTERS);
    await connectDB();
    const counts = await publishedCounts();
    res.json(CLUSTERS.filter((c) => counts.has(c.slug)).map((c) => ({ ...c, posts: counts.get(c.slug) })));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/clusters/:slug — o tema, o post pilar (se publicado) e os demais
 * posts do tema, mais recentes primeiro (R-CLU-03).
 * 404 se o tema não existe ou não tem post publicado (?soft=1: null, sem 404 no console).
 */
exports.publicOne = async (req, res, next) => {
  try {
    const cluster = CLUSTERS.find((c) => c.slug === str(req.params.slug));
    let posts = [];
    if (cluster) {
      await connectDB();
      posts = await BlogPost.find({ ...PUBLISHED, cluster: cluster.slug })
        .select(CLUSTER_POST_FIELDS)
        .sort({ publishedAt: -1, _id: -1 })
        .lean();
    }

    if (!cluster || posts.length === 0) {
      if (req.query.soft === "1") return res.json(null);
      return res.status(404).json({ error: "Tema não encontrado" });
    }

    const list = posts.map(withReadingMinutes);
    res.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=86400");
    res.json({
      cluster,
      pillar: list.find((p) => p.isPillar) || null,
      posts: list.filter((p) => !p.isPillar),
    });
  } catch (err) {
    next(err);
  }
};

module.exports.publishedCounts = publishedCounts;
