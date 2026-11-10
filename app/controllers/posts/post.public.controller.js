const connectDB = require("../../config/db.config");
const BlogPost = require("../../models/blogpost.model");
const SearchQuery = require("../../models/searchquery.model");
const Season = require("../../models/season.model");
const stats = require("../../services/postStats.service");
const limiter = require("../../services/ratelimit.service");
const { str, escapeRegex, isMeaningfulSearch } = require("../../utils/sanitize");
const { withReadingMinutes } = require("../../utils/readingTime");
const { isBot } = require("../../utils/userAgent");
const { dayRangeFilter } = require("../../utils/dates");
const { pickSort } = require("../../utils/listSort");
const { PUBLIC_FIELDS, CARD_FIELDS, RELATED_LIMIT } = require("./post.rules");
const { MAX_PINNED } = require("../../config/showcase");

/**
 * Posts para o leitor (blog público): lista, post por endereço, episódios de
 * season, leituras sugeridas, vitrine (fixados e destaques) e eventos de
 * engajamento. Só posts publicados e fora da lixeira; só campos de PUBLIC_FIELDS
 * ou CARD_FIELDS (R-POST-12).
 */

// Ordem da lista pública (?sort=): o leitor escolhe. _id desempata e evita que
// um post apareça em duas páginas.
const PUBLIC_SORTS = {
  recent: { sort: { publishedAt: -1, createdAt: -1, _id: -1 } },
  oldest: { sort: { publishedAt: 1, createdAt: 1, _id: 1 } },
  popular: { sort: { views: -1, publishedAt: -1, _id: -1 } },
  az: { sort: { title: 1, _id: 1 }, collation: { locale: "pt", strength: 1 } },
};

// Eventos do leitor (favoritar, compartilhar): 60 a cada 10 min por IP
const ENGAGE_MAX = 60;
const ENGAGE_WINDOW_MIN = 10;


/**
 * BLOG PÚBLICO - LIST PUBLISHED
 */
exports.findAllPublished = async (req, res, next) => {
  try {
    await connectDB();

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    // Rota pública: todo parâmetro vira texto (nada de {"$ne": ...}) e a busca é literal
    const q = {
      season: str(req.query.season),
      categories: str(req.query.categories),
      search: str(req.query.search).slice(0, 100),
    };

    const filter = { published: true, deletedAt: null };
    if (q.season) filter.season = q.season;
    // Home sem filtro: os fixados já aparecem na vitrine, não repetem na lista
    if (req.query.excludePinned === "1") filter.pinnedOrder = null;

    if (q.categories) {
      const cats = q.categories.split(",").map((s) => s.trim()).filter(Boolean);
      if (cats.length) filter.category = { $in: cats };
    }

    if (q.search) {
      filter.title = { $regex: escapeRegex(q.search), $options: "i" };

      // Log best-effort — não deve atrapalhar a busca se falhar.
      if (isMeaningfulSearch(q.search)) {
        SearchQuery.create({ term: q.search }).catch(() => {});
      }
    }

    const publishedAt = dayRangeFilter(req.query.dateFrom, req.query.dateTo);
    if (publishedAt) filter.publishedAt = publishedAt;

    const order = PUBLIC_SORTS[pickSort(PUBLIC_SORTS, req.query.sort)];
    // fields=card: lista da home e prerender — só o que o card mostra, sem o conteúdo inteiro
    const fields = req.query.fields === "card" ? CARD_FIELDS : PUBLIC_FIELDS;
    let query = BlogPost.find(filter).select(fields).sort(order.sort).skip(skip).limit(limit);
    if (order.collation) query = query.collation(order.collation);

    const [posts, total] = await Promise.all([
      query,
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

    // Só leitura: a leitura do post é contada pelo navegador (engage "view",
    // BIZ-02). Contar aqui somava prerender e robôs e perdia o que a CDN servia.
    const visible = { published: true, deletedAt: null };
    const slug = str(req.params.slug);
    // Endereço antigo (R-POST-17): devolve o post com o slug atual; o front e o
    // prerender (301) levam o leitor para o endereço novo
    const post =
      (await BlogPost.findOne({ ...visible, slug }).select(PUBLIC_FIELDS).lean()) ||
      (await BlogPost.findOne({ ...visible, previousSlugs: slug }).select(PUBLIC_FIELDS).lean());

    if (!post) {
      // ?soft=1 (front): "não encontrado" é resposta normal, sem erro de rede no
      // console. Sem o parâmetro (prerender, crawlers) continua 404 de verdade.
      if (req.query.soft === "1") return res.json(null);
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(post);
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
    }).select(PUBLIC_FIELDS);

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    next(err);
  }
};

/**
 * BLOG PÚBLICO - EPISÓDIOS PUBLICADOS DE UMA SEASON (navegação)
 */
exports.findSeasonEpisodes = async (req, res, next) => {
  try {
    await connectDB();

    const season = await Season.findOne({ slug: str(req.params.season) }).lean();
    const posts = season
      ? await BlogPost.find({ season: season.slug, published: true, deletedAt: null })
          .select("_id title slug excerpt seasonOrder publishedAt content")
          .sort({ seasonOrder: 1, publishedAt: 1 })
          .lean()
      : [];

    // Season sem episódio publicado não existe para o leitor (nem o nome)
    if (!season || posts.length === 0) {
      return res.status(404).json({ error: "Season não encontrada" });
    }

    res.json({ season: { slug: season.slug, title: season.title }, posts: posts.map(withReadingMinutes) });
  } catch (err) {
    next(err);
  }
};

/**
 * BLOG PÚBLICO - LEITURAS SUGERIDAS ("Continue lendo", fim do post)
 * 1. as escolhidas à mão no editor (relatedPosts), na ordem do autor
 * 2. o resto por afinidade: cada tag em comum vale 3, mesma categoria 1,
 *    mesma season 1; empate (e zero afinidade) vai pelos mais lidos
 * Só publicados, nunca o próprio post. Também entra no HTML pré-renderizado:
 * são os links internos que os buscadores seguem a partir do artigo.
 */
const CARD_PROJECTION = Object.fromEntries(CARD_FIELDS.split(" ").map((f) => [f, 1]));

async function relatedFor(current) {
  const base = { published: true, deletedAt: null };

  const pickIds = (current.relatedPosts || []).filter((id) => String(id) !== String(current._id));
  const picked = pickIds.length
    ? await BlogPost.find({ ...base, _id: { $in: pickIds } }).select(CARD_FIELDS).lean()
    : [];
  const byId = new Map(picked.map((p) => [String(p._id), p]));
  const manual = pickIds.map((id) => byId.get(String(id))).filter(Boolean).slice(0, RELATED_LIMIT);

  const missing = RELATED_LIMIT - manual.length;
  if (missing <= 0) return manual;

  const exclude = [current._id, ...manual.map((p) => p._id)];
  const tags = current.tags || [];
  const auto = await BlogPost.aggregate([
    { $match: { ...base, _id: { $nin: exclude } } },
    {
      $addFields: {
        _score: {
          $add: [
            { $multiply: [3, { $size: { $setIntersection: [{ $ifNull: ["$tags", []] }, tags] } }] },
            { $cond: [{ $eq: ["$category", current.category] }, 1, 0] },
            current.season ? { $cond: [{ $eq: ["$season", current.season] }, 1, 0] } : 0,
          ],
        },
      },
    },
    { $sort: { _score: -1, views: -1, publishedAt: -1, _id: -1 } },
    { $limit: missing },
    { $project: CARD_PROJECTION },
  ]);

  return [...manual, ...auto];
}

exports.findRelated = async (req, res, next) => {
  try {
    await connectDB();
    const current = await BlogPost.findOne({ _id: req.params.id, published: true, deletedAt: null })
      .select("_id category season tags relatedPosts")
      .lean();
    if (!current) return res.status(404).json({ error: "Post não encontrado" });

    res.set("Cache-Control", "public, max-age=300, s-maxage=600, stale-while-revalidate=3600");
    res.json(await relatedFor(current));
  } catch (err) {
    next(err);
  }
};

/**
 * BLOG PÚBLICO - FIXADOS (até 3, na ordem do painel)
 */
exports.findPinned = async (req, res, next) => {
  try {
    await connectDB();
    const posts = await BlogPost.find({ published: true, deletedAt: null, pinnedOrder: { $ne: null } })
      .select(CARD_FIELDS)
      .sort({ pinnedOrder: 1 })
      .limit(MAX_PINNED)
      .lean();
    res.set("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    res.json(posts);
  } catch (err) {
    next(err);
  }
};

/**
 * BLOG PÚBLICO - DESTAQUES DA SEMANA (forçados + mais lidos em 7 dias)
 */
exports.findHighlights = async (req, res, next) => {
  try {
    await connectDB();
    const list = await stats.weeklyHighlights({ fields: CARD_FIELDS });
    res.set("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=900");
    // Leituras ficam só no painel
    res.json(list.map(({ post }) => post));
  } catch (err) {
    next(err);
  }
};

/**
 * BLOG PÚBLICO - EVENTO DO LEITOR
 * body: { type: "view" | "favorite" | "unfavorite" | "share" | "share_visit", channel? }
 * Anônimo: só soma contadores do post, sem identificar quem fez.
 */
exports.engage = async (req, res, next) => {
  try {
    const type = req.body.type || "";
    const channel = (req.body.channel || "").toLowerCase();

    // Robô que roda JavaScript (pré-visualização, auditoria) não conta como leitor
    if (type === "view" && isBot(req.get("user-agent"))) return res.status(204).end();

    await connectDB();
    const wait = await limiter.blockedFor("engage", req, ENGAGE_MAX);
    if (wait) return limiter.tooMany(res, wait);

    const post = await BlogPost.findOne({ _id: req.params.id, published: true, deletedAt: null })
      .select("_id")
      .lean();
    if (!post) return res.status(404).json({ error: "Post não encontrado" });

    await limiter.hit("engage", req, ENGAGE_WINDOW_MIN);
    const ok = await stats.recordEvent(post._id, type, channel);
    if (!ok) return res.status(422).json({ error: "Evento inválido" });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
