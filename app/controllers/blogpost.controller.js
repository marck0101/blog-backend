const connectDB = require("../config/db.config");
const BlogPost = require("../models/blogpost.model");
const SearchQuery = require("../models/searchquery.model");
require("../models/subscriber.model"); // para o populate de emailAudience.subscribers
const { notifyNewPost } = require("../services/campaign.service");
const { safeShareArticle } = require("../services/linkedin.service");
const Season = require("../models/season.model");
const { seasonExists } = require("../services/season.service");
const { str, escapeRegex, isMeaningfulSearch } = require("../utils/sanitize");
const { withReadingMinutes } = require("../utils/readingTime");

// Campos que as rotas públicas podem devolver. Lista de permitidos (não de
// proibidos): campo novo de admin (email, LinkedIn, views…) nunca vaza por padrão.
const PUBLIC_FIELDS =
  "_id title slug excerpt content category coverImage gallery seo season seasonOrder publishedAt createdAt updatedAt";

const ALLOWED_CATEGORIES = ["tecnologia", "design", "carreira", "negocios", "marketing", "trafego", "growth"];

/** Season vazia vira null (post sem season); ordem vazia também */
function normalizeSeason(data) {
  if (data.season !== undefined && !data.season) data.season = null;
  if (data.seasonOrder !== undefined) {
    const order = parseInt(data.seasonOrder, 10);
    data.seasonOrder = Number.isFinite(order) ? order : null;
  }
}

// Status do post:
//   draft     = rascunho (pode ter plannedAt: data no calendário editorial)
//   planned   = agendado: pronto, vai ao ar sozinho na data (cron diário)
//   published = no ar
// "Na lixeira" é deletedAt, independente do status.
function effectiveStatus(data, existing) {
  if (data.status) return data.status;
  if (data.published !== undefined) return data.published ? "published" : "draft";
  return existing?.status ?? "draft";
}

function validatePost(data, isCreate, existing = null) {
  if (isCreate || data.title !== undefined) {
    const title = (data.title || "").trim();
    if (title.length < 3)
      return "O título deve ter pelo menos 3 caracteres";
  }

  const status = effectiveStatus(data, existing);

  // Rascunho pode ser só uma ideia; agendado e publicado precisam de conteúdo
  if (status !== "draft") {
    const content = (data.content ?? existing?.content ?? "").trim();
    if (content.length < 10)
      return "O conteúdo deve ter pelo menos 10 caracteres para agendar ou publicar";
  }

  if (status === "planned") {
    const plannedAt = data.plannedAt !== undefined ? data.plannedAt : existing?.plannedAt;
    if (!plannedAt || Number.isNaN(new Date(plannedAt).getTime()))
      return "Informe a data de publicação do post agendado";
  }
  if (isCreate && data.category === undefined) {
    return "A categoria é obrigatória";
  }
  if (data.category !== undefined && !ALLOWED_CATEGORIES.includes(data.category)) {
    return `Categoria inválida. Valores permitidos: ${ALLOWED_CATEGORIES.join(", ")}`;
  }
  return null;
}

// Falha no email não pode impedir a publicação do post
async function safeNotify(post) {
  try {
    await notifyNewPost(post);
  } catch (err) {
    console.error("[EMAIL]", err);
  }
}

// Primeira publicação: email e LinkedIn em paralelo (cabem juntos no tempo
// da função serverless). Nenhum dos dois desfaz a publicação se falhar.
function announcePost(post) {
  return Promise.all([safeNotify(post), safeShareArticle(post)]);
}

// Do LinkedIn, o painel só edita o conteúdo; status, URNs e erros são do sistema
const LINKEDIN_EDITABLE = ["enabled", "text", "imageUrl", "comment"];
function pickLinkedIn(data) {
  if (!data.linkedin || typeof data.linkedin !== "object") {
    delete data.linkedin;
    return;
  }
  const input = data.linkedin;
  delete data.linkedin;
  for (const field of LINKEDIN_EDITABLE) {
    if (input[field] !== undefined) data[`linkedin.${field}`] = input[field];
  }
}

// Data "YYYY-MM-DD" do formulário → meio-dia UTC: cai no mesmo dia em todos os
// fusos do Brasil (meia-noite UTC apareceria no dia anterior) e fica antes do
// cron diário das 12h UTC.
function normalizePlannedAt(data) {
  if (typeof data.plannedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.plannedAt)) {
    data.plannedAt = `${data.plannedAt}T12:00:00.000Z`;
  }
}

function syncPublished(data) {
  // Suporte a legado: se `status` não veio, deriva do boolean `published`
  if (!data.status && data.published !== undefined) {
    data.status = data.published === true ? "published" : "draft";
  }
  // Atualização parcial (sem status nem published) não mexe na publicação
  if (!data.status) return;

  if (data.status === "published") {
    data.published = true;
    if (!data.publishedAt) data.publishedAt = new Date();
  } else {
    // Rascunho e agendado mantêm a data planejada (calendário)
    data.published = false;
  }
}

/**
 * CREATE
 */
exports.create = async (req, res, next) => {
  try {
    await connectDB();

    const data = req.body;
    normalizeSeason(data);

    const validationError = validatePost(data, true);
    if (validationError) {
      return res.status(422).json({ error: validationError });
    }
    if (data.season && !(await seasonExists(data.season))) {
      return res.status(422).json({ error: "Season inválida" });
    }

    normalizePlannedAt(data);
    syncPublished(data);
    if (data.linkedin) {
      data.linkedin = Object.fromEntries(
        LINKEDIN_EDITABLE.filter((f) => data.linkedin[f] !== undefined).map((f) => [f, data.linkedin[f]])
      );
    }

    const post = await BlogPost.create(data);

    if (post.status === "published") {
      await announcePost(post);
    }

    res.status(201).json(post);
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
 * ADMIN - LIST ALL
 */
exports.findAll = async (req, res, next) => {
  try {
    await connectDB();

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const filter = { deletedAt: null };
    if (req.query.published === "true") filter.published = true;
    if (req.query.published === "false") filter.published = false;
    if (["draft", "planned", "published"].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (str(req.query.season)) filter.season = str(req.query.season);

    if (str(req.query.categories)) {
      const cats = str(req.query.categories).split(",").map((s) => s.trim()).filter(Boolean);
      if (cats.length) filter.category = { $in: cats };
    }

    if (str(req.query.search)) {
      filter.title = { $regex: escapeRegex(str(req.query.search)), $options: "i" };
    }

    if (req.query.dateFrom || req.query.dateTo) {
      filter.createdAt = {};
      if (req.query.dateFrom) filter.createdAt.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) {
        const to = new Date(req.query.dateTo);
        to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }

    const [posts, total] = await Promise.all([
      BlogPost.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      BlogPost.countDocuments(filter),
    ]);

    res.json({ posts, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

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
      dateFrom: str(req.query.dateFrom),
      dateTo: str(req.query.dateTo),
    };

    const filter = { published: true, deletedAt: null };
    if (q.season) filter.season = q.season;

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

    if (q.dateFrom || q.dateTo) {
      filter.publishedAt = {};
      if (q.dateFrom) filter.publishedAt.$gte = new Date(q.dateFrom);
      if (q.dateTo) {
        const to = new Date(q.dateTo);
        to.setHours(23, 59, 59, 999);
        filter.publishedAt.$lte = to;
      }
    }

    const [posts, total] = await Promise.all([
      BlogPost.find(filter)
        .select(PUBLIC_FIELDS)
        // createdAt/_id desempatam posts sem publishedAt e evitam repetição entre páginas
        .sort({ publishedAt: -1, createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
      BlogPost.countDocuments(filter),
    ]);

    res.json({ posts, total, page, totalPages: Math.ceil(total / limit) });
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
 * BLOG PÚBLICO - FIND BY SLUG
 */
exports.findBySlug = async (req, res, next) => {
  try {
    await connectDB();

    const post = await BlogPost.findOneAndUpdate(
      { slug: req.params.slug, published: true, deletedAt: null },
      { $inc: { views: 1 } },
      // Visualização não é edição: sem isso o updatedAt mudava a cada leitura e
      // o sitemap/dados estruturados diziam que todo post foi alterado hoje
      { new: true, timestamps: false, projection: PUBLIC_FIELDS }
    );

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
 * ADMIN - FIND ONE
 */
exports.findOne = async (req, res, next) => {
  try {
    await connectDB();

    const post = await BlogPost.findById(req.params.id).populate(
      "emailAudience.subscribers",
      "name email tier"
    );

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    next(err);
  }
};

/**
 * UPDATE
 */
exports.update = async (req, res, next) => {
  try {
    await connectDB();

    const data = req.body;
    normalizeSeason(data);

    const existing = await BlogPost.findById(req.params.id)
      .select("status publishedAt plannedAt content")
      .lean();

    const validationError = validatePost(data, false, existing);
    if (validationError) {
      return res.status(422).json({ error: validationError });
    }
    if (data.season && !(await seasonExists(data.season))) {
      return res.status(422).json({ error: "Season inválida" });
    }

    // Preserva publishedAt existente ao publicar
    if (data.status === "published" && !data.publishedAt && existing?.publishedAt) {
      data.publishedAt = existing.publishedAt;
    }

    normalizePlannedAt(data);
    syncPublished(data);
    pickLinkedIn(data);

    const post = await BlogPost.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true,
    });

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    if (post.status === "published" && existing?.status !== "published") {
      await announcePost(post);
    }

    res.json(post);
  } catch (err) {
    next(err);
  }
};

/**
 * SOFT DELETE
 */
exports.softDelete = async (req, res, next) => {
  try {
    await connectDB();

    const post = await BlogPost.findByIdAndUpdate(
      req.params.id,
      { deletedAt: new Date() },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    next(err);
  }
};

/**
 * RESTORE
 */
exports.restore = async (req, res, next) => {
  try {
    await connectDB();

    const post = await BlogPost.findByIdAndUpdate(
      req.params.id,
      { deletedAt: null },
      { new: true }
    );

    // Agendado com data já passada voltaria ao ar sozinho no próximo cron
    if (post && post.status === "planned" && post.plannedAt && post.plannedAt < new Date()) {
      post.status = "draft";
      await post.save();
    }

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    next(err);
  }
};

/**
 * LIST TRASH
 */
exports.findAllDeleted = async (req, res, next) => {
  try {
    await connectDB();

    const posts = await BlogPost.find({
      deletedAt: { $ne: null },
    }).sort({ deletedAt: -1 });

    res.json(posts);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE PERMANENT
 */
exports.deletePermanent = async (req, res, next) => {
  try {
    await connectDB();

    const post = await BlogPost.findByIdAndDelete(req.params.id);

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json({ message: "Post removido definitivamente" });
  } catch (err) {
    next(err);
  }
};

/**
 * CALENDAR — posts do mês com plannedAt ou publishedAt
 */
exports.calendar = async (req, res, next) => {
  try {
    await connectDB();

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const posts = await BlogPost.find({
      deletedAt: null,
      $or: [
        { plannedAt: { $gte: start, $lte: end } },
        { publishedAt: { $gte: start, $lte: end } },
        { createdAt: { $gte: start, $lte: end }, status: "draft" },
      ],
    })
      .select("_id title slug status plannedAt publishedAt createdAt")
      .sort({ plannedAt: 1, publishedAt: 1, createdAt: 1 });

    res.json(posts);
  } catch (err) {
    next(err);
  }
};

/**
 * HEATMAP — contagem de publicações por dia no ano
 */
exports.heatmap = async (req, res, next) => {
  try {
    await connectDB();

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);

    const posts = await BlogPost.find({
      published: true,
      deletedAt: null,
      publishedAt: { $gte: start, $lte: end },
    })
      .select("publishedAt")
      .lean();

    const result = {};
    posts.forEach((p) => {
      const d = new Date(p.publishedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      result[key] = (result[key] || 0) + 1;
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
};

/**
 * TODAY PLANNED — posts planejados para hoje
 */
exports.todayPlanned = async (req, res, next) => {
  try {
    await connectDB();

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const posts = await BlogPost.find({
      status: "planned",
      deletedAt: null,
      plannedAt: { $gte: start, $lte: end },
    })
      .select("_id title slug plannedAt")
      .lean();

    res.json(posts);
  } catch (err) {
    next(err);
  }
};

/**
 * REMOVE IMAGE
 */
exports.removeImage = async (req, res, next) => {
  try {
    await connectDB();

    const { imageUrl } = req.body;

    const post = await BlogPost.findByIdAndUpdate(
      req.params.id,
      { $pull: { gallery: { url: imageUrl } } },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(post);
  } catch (err) {
    next(err);
  }
};
