const connectDB = require("../../config/db.config");
const BlogPost = require("../../models/blogpost.model");
const Comment = require("../../models/comment.model");
const Campaign = require("../../models/campaign.model");
const PostDailyStat = require("../../models/postDailyStat.model");
const revisions = require("../../services/postRevision.service");
const { seasonExists } = require("../../services/season.service");
const { str, escapeRegex } = require("../../utils/sanitize");
const { calendarRange } = require("../../utils/calendarRange");
const { dayKey, startOfDay, endOfDay, yearRange, dayRangeFilter } = require("../../utils/dates");
const {
  sanitizeContent, pickLinkedIn, normalizeSlug, normalizeSeason, normalizePlannedAt,
  validatePost, syncPublished, announcePost, revisionAuthor,
} = require("./post.rules");
require("../../models/subscriber.model"); // para o populate de emailAudience.subscribers

/**
 * Posts no painel: criar, listar, editar, lixeira, calendário, heatmap e
 * imagens. As regras (validação, status, publicação) ficam em post.rules.js.
 */

/** R-POST-17: endereço que já é (ou já foi) de outro post. Devolve a mensagem ou null. */
async function slugTakenError(slug, postId = null) {
  if (!slug) return null;
  const query = { $or: [{ slug }, { previousSlugs: slug }] };
  if (postId) query._id = { $ne: postId };
  return (await BlogPost.exists(query)) ? "Esse endereço já é (ou já foi) de outro post. Escolha outro." : null;
}

/** Endereço mudou: guarda o antigo, para o link antigo levar ao novo (R-POST-17) */
async function rememberOldSlug(postId, oldSlug, newSlug) {
  if (!oldSlug || oldSlug === newSlug) return;
  // Duas operações: o MongoDB não deixa $pull e $addToSet no mesmo campo de uma vez
  await BlogPost.updateOne({ _id: postId }, { $pull: { previousSlugs: newSlug } }, { timestamps: false });
  await BlogPost.updateOne({ _id: postId }, { $addToSet: { previousSlugs: oldSlug } }, { timestamps: false });
}

/**
 * CREATE
 */
exports.create = async (req, res, next) => {
  try {
    await connectDB();

    // Formato já validado pelo esquema da rota (validation/posts.schemas.js)
    const data = req.body;
    sanitizeContent(data);
    normalizeSlug(data);
    normalizeSeason(data);

    const validationError = validatePost(data, true);
    if (validationError) {
      return res.status(422).json({ error: validationError });
    }
    const slugError = await slugTakenError(data.slug);
    if (slugError) return res.status(409).json({ error: slugError });
    if (data.season && !(await seasonExists(data.season))) {
      return res.status(422).json({ error: "Season inválida" });
    }

    normalizePlannedAt(data);
    syncPublished(data);

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

    const createdAt = dayRangeFilter(req.query.dateFrom, req.query.dateTo);
    if (createdAt) filter.createdAt = createdAt;

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

    // Formato já validado pelo esquema da rota (validation/posts.schemas.js)
    const data = req.body;
    sanitizeContent(data);
    normalizeSlug(data);
    normalizeSeason(data);

    const existing = await BlogPost.findById(req.params.id)
      .select("status publishedAt plannedAt content slug")
      .lean();

    const validationError = validatePost(data, false, existing);
    if (validationError) {
      return res.status(422).json({ error: validationError });
    }
    if (data.season && !(await seasonExists(data.season))) {
      return res.status(422).json({ error: "Season inválida" });
    }
    if (data.slug && data.slug !== existing?.slug) {
      const slugError = await slugTakenError(data.slug, req.params.id);
      if (slugError) return res.status(409).json({ error: slugError });
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

    await rememberOldSlug(post._id, existing?.slug, post.slug);
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

    // Só sai de vez o que já está na lixeira (o painel garante, a API também)
    const post = await BlogPost.findOneAndDelete({ _id: req.params.id, deletedAt: { $ne: null } });

    if (!post) {
      if (await BlogPost.exists({ _id: req.params.id })) {
        return res.status(409).json({ error: "Mande o post para a lixeira antes de excluir de vez" });
      }
      return res.status(404).json({ error: "Post não encontrado" });
    }

    // Nada fica apontando para o post apagado. Envios ficam (são histórico de
    // quem recebeu o quê), só sem o vínculo.
    await Promise.all([
      revisions.deleteRevisions(post._id),
      Comment.deleteMany({ post: post._id }),
      PostDailyStat.deleteMany({ post: post._id }),
      Campaign.updateMany({ post: post._id }, { $set: { post: null } }, { timestamps: false }),
    ]);

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

    const year = parseInt(req.query.year) || Number(dayKey().slice(0, 4));
    const { start, end } = yearRange(year);

    const posts = await BlogPost.find({
      published: true,
      deletedAt: null,
      publishedAt: { $gte: start, $lte: end },
    })
      .select("publishedAt")
      .lean();

    // { "YYYY-MM-DD": publicações naquele dia, em Brasília }
    const result = {};
    for (const p of posts) {
      const day = dayKey(p.publishedAt);
      result[day] = (result[day] || 0) + 1;
    }

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

    const today = dayKey();
    const posts = await BlogPost.find({
      status: "planned",
      deletedAt: null,
      plannedAt: { $gte: startOfDay(today), $lte: endOfDay(today) },
    })
      .select("_id title slug plannedAt")
      .lean();

    res.json(posts);
  } catch (err) {
    next(err);
  }
};
