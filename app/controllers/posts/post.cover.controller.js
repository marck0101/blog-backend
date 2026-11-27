const connectDB = require("../../config/db.config");
const BlogPost = require("../../models/blogpost.model");
const CATEGORIES = require("../../config/categories");
const CLUSTERS = require("../../config/clusters");
const { str } = require("../../utils/sanitize");
const { renderCoverPng, THEMES, DEFAULT_THEME } = require("../../services/coverCard.service");

/**
 * GET /api/posts/slug/:slug/cover.png?tema=claro|escuro
 * Capa automática 1200x630 (R6) para post publicado sem capa própria. Post que já
 * tem coverImage nunca é sobrescrito: a rota redireciona para a capa dele.
 */

// PNG pronto por post+tema+versão. A chave inclui updatedAt: editou título/categoria,
// a chave muda. Limite pequeno: serverless reinicia o processo com frequência e a CDN
// da Vercel guarda o resto.
const MAX_CACHED = 50;
const cache = new Map();
function remember(key, png) {
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
  cache.set(key, png);
}

exports.cover = async (req, res, next) => {
  try {
    await connectDB();
    const slug = str(req.params.slug);
    const theme = Object.hasOwn(THEMES, req.query.tema) ? req.query.tema : DEFAULT_THEME;

    const post = await BlogPost.findOne({ published: true, deletedAt: null, slug })
      .select("title category cluster publishedAt createdAt updatedAt coverImage")
      .lean();
    if (!post) return res.status(404).json({ error: "Post não encontrado" });

    if (post.coverImage) return res.redirect(302, post.coverImage);

    const key = `${post._id}:${theme}:${new Date(post.updatedAt || 0).getTime()}`;
    let png = cache.get(key);
    if (!png) {
      const cluster = CLUSTERS.find((c) => c.slug === post.cluster);
      const category = CATEGORIES.find((c) => c.slug === post.category);
      png = await renderCoverPng({
        title: post.title,
        label: cluster?.title,
        category: category?.label || post.category,
        date: post.publishedAt || post.createdAt,
        theme,
      });
      remember(key, png);
    }

    res.set({
      "Content-Type": "image/png",
      // Sem ?v= na URL a capa pode mudar (título editado): cache curto. A CDN guarda
      // por 1 dia e revalida em segundo plano.
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    });
    res.send(png);
  } catch (err) {
    next(err);
  }
};
