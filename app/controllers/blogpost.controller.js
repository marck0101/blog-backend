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
const { calendarRange } = require("../utils/calendarRange");
const stats = require("../services/postStats.service");
const limiter = require("../services/ratelimit.service");
const revisions = require("../services/postRevision.service");

// Campos que as rotas públicas podem devolver. Lista de permitidos (não de
// proibidos): campo novo de admin (email, LinkedIn, views…) nunca vaza por padrão.
const PUBLIC_FIELDS =
  "_id title slug excerpt content category coverImage coverImageAlt gallery faq seo season seasonOrder publishedAt createdAt updatedAt commentsCount";

// Cards da vitrine (fixados e destaques): sem o conteúdo inteiro
const CARD_FIELDS = "_id title slug excerpt category coverImage coverImageAlt season publishedAt createdAt commentsCount";

const MAX_PINNED = 3;

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

// Quem fez a alteração, para o histórico de versões
const revisionAuthor = (req) => ({ id: req.userId, name: req.user?.name || req.user?.email || "" });

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
    await revisions.safeRecordRevision(post, { reason: "create", author: revisionAuthor(req) });

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

    if (q.dateFrom || q.dateTo) {
      filter.publishedAt = {};
      if (q.dateFrom) filter.publishedAt.$gte = new Date(q.dateFrom);
      if (q.dateTo) {
        const to = new Date(q.dateTo);
        to.setHours(23, 59, 59, 999);
        filter.publishedAt.$lte = to;
      }
    }

    const order = PUBLIC_SORTS[str(req.query.sort)] || PUBLIC_SORTS.recent;
    let query = BlogPost.find(filter).select(PUBLIC_FIELDS).sort(order.sort).skip(skip).limit(limit);
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

    if (post) await stats.recordView(post._id);

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

    // Post sem histórico: o estado de antes vira a v1 antes de ser alterado
    await revisions.ensureBaseline(req.params.id);

    const post = await BlogPost.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true,
    });

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    await revisions.safeRecordRevision(post, { author: revisionAuthor(req) });

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

    // Na lixeira sai da vitrine (ao restaurar, fixar de novo é decisão do painel)
    const post = await BlogPost.findByIdAndUpdate(
      req.params.id,
      { deletedAt: new Date(), pinnedOrder: null },
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

    await revisions.deleteRevisions(post._id);

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

    const { start, end } = calendarRange(req.query);

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

    await revisions.ensureBaseline(req.params.id);

    const post = await BlogPost.findByIdAndUpdate(
      req.params.id,
      { $pull: { gallery: { url: imageUrl } } },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    await revisions.safeRecordRevision(post, { reason: "image-removed", author: revisionAuthor(req) });

    res.json(post);
  } catch (err) {
    next(err);
  }
};

/* ================= HISTÓRICO DE VERSÕES (ADMIN) ================= */

const parseVersion = (value) => {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
};

/**
 * HISTÓRICO — versões do post, mais nova primeiro (sem o conteúdo)
 */
exports.listRevisions = async (req, res, next) => {
  try {
    await connectDB();

    if (!(await BlogPost.exists({ _id: req.params.id }))) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(await revisions.listRevisions(req.params.id));
  } catch (err) {
    next(err);
  }
};

/**
 * HISTÓRICO — uma versão completa
 */
exports.getRevision = async (req, res, next) => {
  try {
    await connectDB();

    const version = parseVersion(req.params.version);
    const revision = version && (await revisions.getRevision(req.params.id, version));
    if (!revision) {
      return res.status(404).json({ error: "Versão não encontrada" });
    }

    res.json(revision);
  } catch (err) {
    next(err);
  }
};

/**
 * HISTÓRICO — restaura uma versão. Não apaga nada: o conteúdo dela vira uma
 * versão nova (o estado de antes continua no histórico). Status, datas, email
 * e LinkedIn não mudam; o endereço (slug) atual é mantido para não quebrar links.
 */
exports.restoreRevision = async (req, res, next) => {
  try {
    await connectDB();

    const version = parseVersion(req.params.version);
    const revision = version && (await revisions.getRevision(req.params.id, version));
    if (!revision) {
      return res.status(404).json({ error: "Versão não encontrada" });
    }

    const existing = await BlogPost.findById(req.params.id).select("status plannedAt content slug season").lean();
    if (!existing) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    const fields = Object.fromEntries(
      revisions.REVISION_FIELDS.filter((f) => f !== "slug").map((f) => [f, revision.snapshot[f]])
    );
    // Sem o slug no update, mudar o título geraria um endereço novo
    fields.slug = existing.slug;
    // Season apagada depois da versão: o post fica na season atual
    if (fields.season && !(await seasonExists(fields.season))) {
      fields.season = existing.season ?? null;
    }

    const validationError = validatePost(fields, false, existing);
    if (validationError) {
      return res.status(422).json({ error: validationError });
    }

    await revisions.ensureBaseline(req.params.id);

    const post = await BlogPost.findByIdAndUpdate(req.params.id, fields, {
      new: true,
      runValidators: true,
    });

    await revisions.safeRecordRevision(post, {
      reason: "restore",
      restoredFrom: version,
      author: revisionAuthor(req),
    });

    res.json(post);
  } catch (err) {
    next(err);
  }
};

/* ================= VITRINE (PÚBLICO) ================= */

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
 * body: { type: "favorite" | "unfavorite" | "share" | "share_visit", channel? }
 * Anônimo: só soma contadores do post, sem identificar quem fez.
 */
exports.engage = async (req, res, next) => {
  try {
    const type = str(req.body?.type);
    const channel = str(req.body?.channel).toLowerCase();

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

/* ================= VITRINE (ADMIN) ================= */

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
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))] : null;
    if (!ids) return res.status(422).json({ error: "Envie a lista de posts fixados" });
    if (ids.length > MAX_PINNED) return res.status(422).json({ error: `Fixe no máximo ${MAX_PINNED} posts` });

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
    const highlight = req.body?.highlight;
    if (!["auto", "force", "hide"].includes(highlight)) return res.status(422).json({ error: "Opção inválida" });

    await connectDB();
    const post = await BlogPost.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { $set: { highlight } },
      { new: true, timestamps: false, projection: "_id highlight" }
    );
    if (!post) return res.status(404).json({ error: "Post não encontrado" });
    res.json(post);
  } catch (err) {
    next(err);
  }
};

/**
 * BLOG PÚBLICO - LEITURAS SUGERIDAS ("Continue lendo", fim do post)
 * Mesma categoria, mais lidos primeiro; se faltar, completa com os mais lidos
 * das outras categorias. Nunca o próprio post.
 */
const RELATED_LIMIT = 3;

exports.findRelated = async (req, res, next) => {
  try {
    await connectDB();
    const current = await BlogPost.findOne({ _id: req.params.id, published: true, deletedAt: null })
      .select("_id category")
      .lean();
    if (!current) return res.status(404).json({ error: "Post não encontrado" });

    const base = { published: true, deletedAt: null, _id: { $ne: current._id } };
    const order = { views: -1, publishedAt: -1, _id: -1 };

    const sameCategory = await BlogPost.find({ ...base, category: current.category })
      .select(CARD_FIELDS)
      .sort(order)
      .limit(RELATED_LIMIT)
      .lean();

    let others = [];
    if (sameCategory.length < RELATED_LIMIT) {
      others = await BlogPost.find({ ...base, category: { $ne: current.category } })
        .select(CARD_FIELDS)
        .sort(order)
        .limit(RELATED_LIMIT - sameCategory.length)
        .lean();
    }

    res.set("Cache-Control", "public, max-age=300, s-maxage=600, stale-while-revalidate=3600");
    res.json([...sameCategory, ...others]);
  } catch (err) {
    next(err);
  }
};
