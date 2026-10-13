const slugify = require("slugify");
const connectDB = require("../config/db.config");
const Season = require("../models/season.model");
const BlogPost = require("../models/blogpost.model");
const { ensureDefaultSeasons } = require("../services/season.service");
const { str } = require("../utils/sanitize");

// Campos de episódio que o leitor vê (lista de permitidos, como nos posts)
const EPISODE_FIELDS = "_id title slug excerpt coverImage category seasonOrder publishedAt";

const PUBLISHED = { published: true, deletedAt: null };

// Contagem de episódios publicados por season (+ capa do primeiro episódio)
async function publishedStats() {
  const rows = await BlogPost.aggregate([
    { $match: { ...PUBLISHED, season: { $ne: null } } },
    { $sort: { seasonOrder: 1, publishedAt: 1 } },
    {
      $group: {
        _id: "$season",
        episodes: { $sum: 1 },
        coverImage: { $first: "$coverImage" },
        firstSlug: { $first: "$slug" },
        lastPublishedAt: { $max: "$publishedAt" },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id, r]));
}

/**
 * PÚBLICO — seasons com pelo menos 1 episódio publicado.
 * Season só com rascunhos/agendados não aparece (nem o nome).
 */
exports.publicList = async (req, res, next) => {
  try {
    await connectDB();
    await ensureDefaultSeasons();

    const [seasons, stats] = await Promise.all([
      Season.find().sort({ order: 1, createdAt: 1 }).lean(),
      publishedStats(),
    ]);

    res.json(
      seasons
        .filter((s) => stats.has(s.slug))
        .map((s) => {
          const st = stats.get(s.slug);
          return {
            slug: s.slug,
            title: s.title,
            description: s.description,
            episodes: st.episodes,
            coverImage: st.coverImage || "",
            firstSlug: st.firstSlug,
            lastPublishedAt: st.lastPublishedAt,
          };
        })
    );
  } catch (err) {
    next(err);
  }
};

/**
 * PÚBLICO — uma season e seus episódios publicados, em ordem.
 * 404 se a season não existe OU ainda não tem episódio publicado.
 */
exports.publicOne = async (req, res, next) => {
  try {
    await connectDB();
    await ensureDefaultSeasons();

    const season = await Season.findOne({ slug: str(req.params.slug) }).lean();
    const posts = season
      ? await BlogPost.find({ ...PUBLISHED, season: season.slug })
          .select(EPISODE_FIELDS)
          .sort({ seasonOrder: 1, publishedAt: 1 })
          .lean()
      : [];

    if (!season || posts.length === 0) {
      // ?soft=1 (front): sem 404 no console; crawlers continuam recebendo 404
      if (req.query.soft === "1") return res.json(null);
      return res.status(404).json({ error: "Season não encontrada" });
    }

    res.json({
      season: { slug: season.slug, title: season.title, description: season.description },
      posts,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * ADMIN — todas as seasons, com contagem de posts por status
 */
exports.adminList = async (req, res, next) => {
  try {
    await connectDB();
    await ensureDefaultSeasons();

    const [seasons, counts] = await Promise.all([
      Season.find().sort({ order: 1, createdAt: 1 }).lean(),
      BlogPost.aggregate([
        { $match: { deletedAt: null, season: { $ne: null } } },
        { $group: { _id: { season: "$season", status: "$status" }, n: { $sum: 1 } } },
      ]),
    ]);

    const bySeason = {};
    for (const c of counts) {
      const s = (bySeason[c._id.season] ||= { draft: 0, planned: 0, published: 0, total: 0 });
      s[c._id.status] = (s[c._id.status] || 0) + c.n;
      s.total += c.n;
    }

    res.json(
      seasons.map((s) => ({
        ...s,
        posts: bySeason[s.slug] || { draft: 0, planned: 0, published: 0, total: 0 },
      }))
    );
  } catch (err) {
    next(err);
  }
};

function pickSeason(body) {
  const data = {};
  if (body.title !== undefined) data.title = str(body.title);
  if (body.description !== undefined) data.description = str(body.description);
  if (body.order !== undefined) {
    const order = parseInt(body.order, 10);
    data.order = Number.isFinite(order) ? order : 0;
  }
  if (body.slug !== undefined) data.slug = slugify(str(body.slug), { lower: true, strict: true });
  return data;
}

// "admin" é rota (/api/seasons/admin), não pode ser slug de season
function reservedSlug(res, slug) {
  if (slug === "admin") {
    res.status(422).json({ error: "Esse slug é reservado. Escolha outro." });
    return true;
  }
  return false;
}

/**
 * ADMIN — criar season
 */
exports.create = async (req, res, next) => {
  try {
    await connectDB();
    const data = pickSeason(req.body || {});
    if (!data.slug) data.slug = slugify(data.title || "", { lower: true, strict: true });
    if (reservedSlug(res, data.slug)) return;
    const season = await Season.create(data);
    res.status(201).json(season);
  } catch (err) {
    next(err);
  }
};

/**
 * ADMIN — editar season. Trocar o slug atualiza os posts que usam a season.
 */
exports.update = async (req, res, next) => {
  try {
    await connectDB();
    const season = await Season.findById(req.params.id);
    if (!season) return res.status(404).json({ error: "Season não encontrada" });

    const data = pickSeason(req.body || {});
    if (data.slug !== undefined && reservedSlug(res, data.slug)) return;
    const oldSlug = season.slug;
    Object.assign(season, data);
    await season.save();

    if (data.slug && data.slug !== oldSlug) {
      await BlogPost.updateMany({ season: oldSlug }, { $set: { season: data.slug } });
    }

    res.json(season);
  } catch (err) {
    next(err);
  }
};

/**
 * ADMIN — excluir season (só se nenhum post, nem na lixeira, usa ela)
 */
exports.remove = async (req, res, next) => {
  try {
    await connectDB();
    const season = await Season.findById(req.params.id);
    if (!season) return res.status(404).json({ error: "Season não encontrada" });

    const inUse = await BlogPost.countDocuments({ season: season.slug });
    if (inUse > 0) {
      return res.status(409).json({
        error: `Esta season tem ${inUse} post(s). Tire os posts da season antes de excluir.`,
      });
    }

    await season.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
