const express = require("express");
const router = express.Router();
const BlogPost = require("../models/blogpost.model");

const SITE_URL = "https://blog.marck0101.com.br";

const STATIC_PAGES = [
  { loc: SITE_URL, changefreq: "daily", priority: "1.0" },
  { loc: `${SITE_URL}/blog`, changefreq: "daily", priority: "1.0" },
  { loc: `${SITE_URL}/privacidade`, changefreq: "yearly", priority: "0.3" },
];

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

router.get("/sitemap.xml", async (req, res) => {
  try {
    const posts = await BlogPost.find(
      { published: true, deletedAt: null },
      { slug: 1, updatedAt: 1, publishedAt: 1 }
    ).sort({ publishedAt: -1 });

    const staticEntries = STATIC_PAGES.map(
      ({ loc, changefreq, priority }) => `
  <url>
    <loc>${escapeXml(loc)}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
    ).join("");

    const postEntries = posts
      .map((post) => {
        const loc = `${SITE_URL}/blog/${escapeXml(post.slug)}`;
        const lastmod = toW3CDate(post.updatedAt || post.publishedAt);
        return `
  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
      })
      .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${staticEntries}${postEntries}
</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.send(xml);
  } catch (err) {
    res.status(500).send("Erro ao gerar sitemap");
  }
});

module.exports = router;
