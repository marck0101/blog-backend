const express = require("express");
const router = express.Router();
const connectDB = require("../config/db.config");
const BlogPost = require("../models/blogpost.model");

const SITE_URL = "https://blog.marck0101.com.br";

// "/" redireciona para "/blog" — só URLs canônicas entram no sitemap.
// changefreq/priority são ignorados pelo Google; lastmod é o que importa.
const STATIC_PAGES = [{ loc: `${SITE_URL}/blog` }];

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toW3CDate(date) {
  return new Date(date).toISOString().split("T")[0];
}

function urlEntry(loc, lastmod) {
  return `
  <url>
    <loc>${escapeXml(loc)}</loc>${lastmod ? `
    <lastmod>${lastmod}</lastmod>` : ""}
  </url>`;
}

router.get("/sitemap.xml", async (req, res) => {
  try {
    await connectDB();

    const posts = await BlogPost.find(
      { published: true, deletedAt: null },
      { slug: 1, updatedAt: 1, publishedAt: 1 }
    ).sort({ publishedAt: -1 });

    const latest = posts[0]
      ? toW3CDate(posts[0].updatedAt || posts[0].publishedAt)
      : null;

    const staticEntries = STATIC_PAGES.map(({ loc }) => urlEntry(loc, latest)).join("");

    const postEntries = posts
      .map((post) =>
        urlEntry(
          `${SITE_URL}/blog/${post.slug}`,
          toW3CDate(post.updatedAt || post.publishedAt)
        )
      )
      .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${staticEntries}${postEntries}
</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
    res.send(xml);
  } catch (err) {
    console.error("[SITEMAP]", err);
    res.status(500).send("Erro ao gerar sitemap");
  }
});

router.get("/rss.xml", async (req, res) => {
  try {
    await connectDB();

    const posts = await BlogPost.find(
      { published: true, deletedAt: null },
      { slug: 1, title: 1, excerpt: 1, seo: 1, category: 1, publishedAt: 1, updatedAt: 1 }
    )
      .sort({ publishedAt: -1 })
      .limit(50);

    const items = posts
      .map((post) => {
        const link = `${SITE_URL}/blog/${post.slug}`;
        const description = post.seo?.description || post.excerpt || "";
        return `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <description>${escapeXml(description)}</description>
      <category>${escapeXml(post.category)}</category>
      <dc:creator>Marcos Henrique Corrêa</dc:creator>
      <pubDate>${new Date(post.publishedAt || post.updatedAt).toUTCString()}</pubDate>
    </item>`;
      })
      .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Blog do Marcos Henrique Corrêa</title>
    <link>${SITE_URL}/blog</link>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Artigos sobre marketing digital, tráfego pago, growth e tecnologia.</description>
    <language>pt-BR</language>${items}
  </channel>
</rss>`;

    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
    res.send(xml);
  } catch (err) {
    console.error("[RSS]", err);
    res.status(500).send("Erro ao gerar RSS");
  }
});

module.exports = router;
