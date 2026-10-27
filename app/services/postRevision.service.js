const crypto = require("crypto");
const BlogPost = require("../models/blogpost.model");
const PostRevision = require("../models/postRevision.model");

// O que o histórico guarda: o que o leitor vê. Status, datas, email, LinkedIn,
// vitrine e métricas ficam de fora, então restaurar uma versão não despublica,
// não reagenda e não reenvia nada.
const REVISION_FIELDS = [
  "title",
  "slug",
  "excerpt",
  "content",
  "category",
  "season",
  "seasonOrder",
  "coverImage",
  "coverImageAlt",
  "gallery",
  "faq",
  "seo",
];

const MAX_VERSION_RETRIES = 3;

/** Campos do histórico em ordem fixa e sem undefined (o hash depende disso) */
function snapshotOf(post) {
  const p = typeof post.toObject === "function" ? post.toObject() : post;
  return {
    title: p.title || "",
    slug: p.slug || "",
    excerpt: p.excerpt || "",
    content: p.content || "",
    category: p.category || "",
    season: p.season || null,
    seasonOrder: p.seasonOrder ?? null,
    coverImage: p.coverImage || "",
    coverImageAlt: p.coverImageAlt || "",
    gallery: (p.gallery || []).map((g) => ({ url: g.url || "", alt: g.alt || "" })),
    faq: (p.faq || []).map((f) => ({ question: f.question || "", answer: f.answer || "" })),
    seo: { title: p.seo?.title || "", description: p.seo?.description || "" },
  };
}

const hashOf = (snapshot) => crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");

const countImages = (html) => (html.match(/<img\b/gi) || []).length;

/**
 * Grava o estado atual do post como versão nova. Não grava se nada do
 * histórico mudou desde a última versão. Devolve a versão criada ou null.
 */
async function recordRevision(post, { reason = "edit", restoredFrom = null, author = null } = {}) {
  const snapshot = snapshotOf(post);
  const hash = hashOf(snapshot);

  for (let attempt = 1; ; attempt++) {
    const last = await PostRevision.findOne({ post: post._id })
      .sort({ version: -1 })
      .select("version hash snapshot")
      .lean();
    if (last?.hash === hash) return null;

    const changes = last
      ? REVISION_FIELDS.filter((f) => JSON.stringify(last.snapshot[f]) !== JSON.stringify(snapshot[f]))
      : [];

    try {
      return await PostRevision.create({
        post: post._id,
        version: (last?.version || 0) + 1,
        snapshot,
        summary: { title: snapshot.title, images: countImages(snapshot.content), chars: snapshot.content.length },
        changes,
        reason,
        restoredFrom,
        author: { id: author?.id || null, name: author?.name || "" },
        hash,
      });
    } catch (err) {
      // Duas gravações ao mesmo tempo pegaram o mesmo número: tenta o seguinte
      if (err?.code !== 11000 || attempt >= MAX_VERSION_RETRIES) throw err;
    }
  }
}

/**
 * Post sem histórico (criado antes do versionamento): guarda o estado atual
 * como v1 antes da primeira alteração. Se falhar, a edição não deve seguir.
 */
async function ensureBaseline(postId) {
  if (await PostRevision.exists({ post: postId })) return;
  const post = await BlogPost.findById(postId).lean();
  if (post) await recordRevision(post, { reason: "baseline" });
}

// Depois de gravar o post: falha no histórico não desfaz a edição já feita
async function safeRecordRevision(post, options) {
  try {
    await recordRevision(post, options);
  } catch (err) {
    console.error("[HISTÓRICO]", err);
  }
}

/** Lista para o painel: mais nova primeiro, sem o conteúdo de cada versão */
function listRevisions(postId) {
  return PostRevision.find({ post: postId })
    .sort({ version: -1 })
    .select("version summary changes reason restoredFrom author createdAt")
    .lean();
}

function getRevision(postId, version) {
  return PostRevision.findOne({ post: postId, version }).lean();
}

function deleteRevisions(postId) {
  return PostRevision.deleteMany({ post: postId });
}

module.exports = {
  REVISION_FIELDS,
  recordRevision,
  ensureBaseline,
  safeRecordRevision,
  listRevisions,
  getRevision,
  deleteRevisions,
};
