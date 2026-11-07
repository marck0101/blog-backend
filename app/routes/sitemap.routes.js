const express = require("express");
const router = express.Router();
const connectDB = require("../config/db.config");
const BlogPost = require("../models/blogpost.model");
const Season = require("../models/season.model");
const CATEGORIES = require("../config/categories");
const { indexNowKey } = require("../services/indexnow.service");

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
      { slug: 1, updatedAt: 1, publishedAt: 1, season: 1 }
    ).sort({ publishedAt: -1 });

    // Seasons entram só se têm episódio publicado; lastmod = episódio mais recente
    const seasonLastmod = new Map();
    for (const p of posts) {
      if (p.season && !seasonLastmod.has(p.season)) seasonLastmod.set(p.season, p.updatedAt || p.publishedAt);
    }
    const seasons = await Season.find({ slug: { $in: [...seasonLastmod.keys()] } }, { slug: 1 }).lean();
    const seasonEntries = seasons.length
      ? urlEntry(`${SITE_URL}/seasons`, toW3CDate(Math.max(...seasons.map((x) => new Date(seasonLastmod.get(x.slug))))) ) +
        seasons.map((x) => urlEntry(`${SITE_URL}/seasons/${x.slug}`, toW3CDate(seasonLastmod.get(x.slug)))).join("")
      : "";

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
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${staticEntries}${seasonEntries}${postEntries}
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

// Chave do IndexNow: os buscadores conferem que o aviso veio do dono do domínio
// (blog.marck0101.com.br/indexnow-key.txt é reescrito para cá pelo front)
router.get("/indexnow-key.txt", (req, res) => {
  const key = indexNowKey();
  if (!key) return res.status(404).type("text/plain").send("Not found");
  res.set("Cache-Control", "public, max-age=86400");
  res.type("text/plain").send(key);
});

/* ================= ARQUIVOS PARA IA (llmstxt.org) =================
 * Gerados do banco a cada acesso: publicar um post (no painel ou pelo cron)
 * já atualiza os dois, sem passo manual. Só entra o que é público:
 * post publicado e fora da lixeira, season com episódio publicado.
 *   /llms.txt       mapa curto: os 10 posts mais recentes, seasons e categorias
 *   /llms-full.txt  conteúdo completo de todos os posts publicados, em Markdown
 */
const TurndownService = require("turndown");
const { BLOG_FAQ, SEASONS_FAQ } = require("../config/siteFaq");

const LLMS_RECENT = 10;
const PUBLISHED = { published: true, deletedAt: null };
// Cache curto na CDN: post novo aparece em até 5 min
const LLMS_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=86400";

const LLMS_TITLE = "# Blog do Marcos Henrique Corrêa";
const LLMS_SUMMARY =
  "> Artigos práticos em português sobre marketing digital, tráfego pago, growth e tecnologia, escritos por Marcos Henrique Corrêa, desenvolvedor full stack e gestor de tráfego.";

// Markdown de uma linha: sem quebras que quebrariam a lista
const oneLine = (str = "") => String(str).replace(/\s+/g, " ").trim();
// Texto de link Markdown: colchetes do título ("[TESTE] ...") quebrariam o link
const linkText = (str = "") => oneLine(str).replace(/([[\]])/g, "\\$1");
const dateBR = (d) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
const categoryLabel = (slug) => CATEGORIES.find((c) => c.slug === slug)?.label || slug;
const postLink = (p) => `${SITE_URL}/blog/${p.slug}`;

// Seasons públicas (com pelo menos um episódio publicado), na ordem do painel
async function publicSeasons() {
  const [seasons, counts] = await Promise.all([
    Season.find({}, { slug: 1, title: 1, description: 1, faq: 1, order: 1 }).sort({ order: 1, createdAt: 1 }).lean(),
    BlogPost.aggregate([{ $match: { ...PUBLISHED, season: { $ne: null } } }, { $group: { _id: "$season", n: { $sum: 1 } } }]),
  ]);
  const episodes = new Map(counts.map((c) => [c._id, c.n]));
  return seasons.filter((s) => episodes.has(s.slug)).map((s) => ({ ...s, episodes: episodes.get(s.slug) }));
}

function sendText(res, txt) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", LLMS_CACHE);
  res.send(txt);
}

router.get("/llms.txt", async (req, res) => {
  try {
    await connectDB();
    const [posts, total, seasons] = await Promise.all([
      BlogPost.find(PUBLISHED, { slug: 1, title: 1, excerpt: 1, seo: 1, category: 1, publishedAt: 1 })
        .sort({ publishedAt: -1, _id: -1 })
        .limit(LLMS_RECENT)
        .lean(),
      BlogPost.countDocuments(PUBLISHED),
      publicSeasons(),
    ]);

    const recent = posts.map((p) => {
      const summary = oneLine(p.seo?.description || p.excerpt);
      return `- [${linkText(p.title)}](${postLink(p)}): ${dateBR(p.publishedAt)} · ${categoryLabel(p.category)}${summary ? `. ${summary}` : ""}`;
    });
    const seasonItems = seasons.map(
      (s) => `- [${linkText(s.title)}](${SITE_URL}/seasons/${s.slug}): ${s.episodes} episódio(s)${s.description ? `. ${oneLine(s.description)}` : ""}`
    );
    const categoryItems = CATEGORIES.map(({ slug, label }) => `- [${label}](${SITE_URL}/blog?categoria=${slug})`);

    const txt = `${LLMS_TITLE}

${LLMS_SUMMARY}

- Conteúdo completo de todos os ${total} artigos, em Markdown: ${SITE_URL}/llms-full.txt
- Lista completa e datas: ${SITE_URL}/sitemap.xml
- Últimos artigos (RSS): ${SITE_URL}/rss.xml

## Artigos mais recentes

${recent.join("\n")}
${seasonItems.length ? `\n## Seasons (séries para ler em sequência)\n\n${seasonItems.join("\n")}\n` : ""}
## Categorias

${categoryItems.join("\n")}

## Optional

- [Todas as seasons](${SITE_URL}/seasons)
- [Política de Privacidade](${SITE_URL}/privacidade)
`;
    sendText(res, txt);
  } catch (err) {
    console.error("[LLMS]", err);
    res.status(500).send("Erro ao gerar llms.txt");
  }
});

// HTML do editor (TipTap) → Markdown. Links do próprio blog viram absolutos;
// embeds e scripts saem (não são texto).
function markdownConverter() {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  td.remove(["script", "style", "iframe", "noscript", "button", "form"]);
  const absolute = (url = "") => (url.startsWith("/") ? `${SITE_URL}${url}` : url);
  td.addRule("absoluteLinks", {
    filter: (node) => node.nodeName === "A" && node.getAttribute("href"),
    replacement: (content, node) => (content.trim() ? `[${content}](${absolute(node.getAttribute("href"))})` : ""),
  });
  td.addRule("absoluteImages", {
    filter: "img",
    replacement: (content, node) => {
      const src = node.getAttribute("src");
      return src ? `![${oneLine(node.getAttribute("alt") || "")}](${absolute(src)})` : "";
    },
  });
  // Títulos do post ficam abaixo do título do artigo ("##"): h2 → ###, h3 → ####
  td.addRule("nestedHeadings", {
    filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
    replacement: (content, node) => {
      const level = Math.min(6, Math.max(3, Number(node.nodeName[1]) + 1));
      return `\n\n${"#".repeat(level)} ${oneLine(content)}\n\n`;
    },
  });
  // O editor põe <p> dentro de cada <li>: item com um parágrafo só vira lista
  // compacta (sem linha em branco entre os itens)
  td.addRule("tightListParagraph", {
    filter: (node) =>
      node.nodeName === "P" && node.parentNode?.nodeName === "LI" && node.parentNode.children.length === 1,
    replacement: (content) => content,
  });
  return td;
}

const faqMarkdown = (faq, heading) => {
  const pairs = (faq || []).filter((f) => f?.question?.trim() && f?.answer?.trim());
  if (!pairs.length) return "";
  return `\n\n${heading} Perguntas frequentes\n\n${pairs.map((f) => `**${oneLine(f.question)}**\n\n${f.answer.trim()}`).join("\n\n")}`;
};

router.get("/llms-full.txt", async (req, res) => {
  try {
    await connectDB();
    const [posts, seasons] = await Promise.all([
      BlogPost.find(PUBLISHED, {
        slug: 1, title: 1, excerpt: 1, directAnswer: 1, content: 1, category: 1, tags: 1,
        season: 1, seasonOrder: 1, faq: 1, readingMinutes: 1, publishedAt: 1, updatedAt: 1, seo: 1,
      })
        .sort({ publishedAt: -1, _id: -1 })
        .lean(),
      publicSeasons(),
    ]);
    const seasonTitle = new Map(seasons.map((s) => [s.slug, s.title]));
    const td = markdownConverter();

    const articles = posts.map((p) => {
      const meta = [
        `- URL: ${postLink(p)}`,
        `- Publicado em: ${dateBR(p.publishedAt)}`,
        p.updatedAt && dateBR(p.updatedAt) !== dateBR(p.publishedAt) ? `- Atualizado em: ${dateBR(p.updatedAt)}` : "",
        `- Categoria: ${categoryLabel(p.category)}`,
        p.season && seasonTitle.has(p.season)
          ? `- Season: ${seasonTitle.get(p.season)}${p.seasonOrder ? ` (episódio ${p.seasonOrder})` : ""}`
          : "",
        p.tags?.length ? `- Tags: ${p.tags.map((t) => t.replace(/-/g, " ")).join(", ")}` : "",
        p.readingMinutes ? `- Leitura: ${p.readingMinutes} min` : "",
        "- Autor: Marcos Henrique Corrêa",
      ].filter(Boolean);
      const summary = oneLine(p.seo?.description || p.excerpt);
      const answer = p.directAnswer?.trim() ? `\n\n**Resposta direta:** ${oneLine(p.directAnswer)}` : "";
      const body = td.turndown(p.content || "").trim();
      return `## ${oneLine(p.title)}\n\n${meta.join("\n")}${summary ? `\n\n> ${summary}` : ""}${answer}\n\n${body}${faqMarkdown(p.faq, "###")}`;
    });

    const seasonBlocks = seasons.map(
      (s) =>
        `## Season: ${oneLine(s.title)}\n\n- URL: ${SITE_URL}/seasons/${s.slug}\n- Episódios publicados: ${s.episodes}${
          s.description ? `\n\n${s.description.trim()}` : ""
        }${faqMarkdown(s.faq, "###")}`
    );

    // Mesmo FAQ visível na home e em /seasons
    const qa = (items) => items.map((f) => `**${oneLine(f.question)}**\n\n${f.answer.trim()}`).join("\n\n");
    const about = `## Sobre o blog\n\n- Autor: Marcos Henrique Corrêa (https://marck0101.com.br/)\n- Site: ${SITE_URL}/blog\n\n${qa(BLOG_FAQ)}\n\n### Sobre as seasons\n\n${qa(SEASONS_FAQ)}`;

    const txt = `${LLMS_TITLE} — conteúdo completo

${LLMS_SUMMARY}

Todos os ${posts.length} artigos publicados, do mais recente ao mais antigo, com o texto integral em Markdown. Gerado automaticamente a cada publicação. Versão resumida: ${SITE_URL}/llms.txt

${[about, ...articles, ...seasonBlocks].join("\n\n---\n\n")}
`;
    sendText(res, txt);
  } catch (err) {
    console.error("[LLMS-FULL]", err);
    res.status(500).send("Erro ao gerar llms-full.txt");
  }
});

module.exports = router;
