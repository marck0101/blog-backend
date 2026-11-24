const { SITE_URL } = require("../config/urls");

/**
 * Mapa de conteúdo do painel (seção 20 do SISTEMA.md): como os posts se ligam.
 *
 * Nós: posts (fora da lixeira), tags e seasons. Ligações:
 * - link    : post A tem no texto um link para o post B (a ligação que conta para SEO)
 * - related : B está nas leituras sugeridas escolhidas à mão em A
 * - tag     : post → tag
 * - season  : post → season
 *
 * Diagnóstico (o que pede ação):
 * - orphans    : publicado que nenhum outro publicado aponta (texto ou leituras sugeridas)
 * - brokenLinks: link interno para post que não existe, está na lixeira, não foi
 *                publicado ou usa um endereço antigo (funciona pelo 301, mas é um salto a mais)
 * - singleTags : tag usada por um post só (não liga nada a nada)
 */

const SITE_HOST = new URL(SITE_URL).host;

/** Slugs dos posts do blog linkados no HTML (relativos ou com o domínio do blog), sem repetir */
function internalSlugs(html) {
  const slugs = [];
  const re = /href\s*=\s*(["'])(.*?)\1/gi;
  let match;
  while ((match = re.exec(String(html || "")))) {
    const slug = slugFromHref(match[2]);
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

function slugFromHref(rawHref) {
  const href = String(rawHref).replace(/&amp;/g, "&").trim();
  let path;
  if (href.startsWith("/")) {
    if (href.startsWith("//")) return null;
    path = href;
  } else if (/^https?:\/\//i.test(href)) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.host !== SITE_HOST && url.host !== `www.${SITE_HOST}`) return null;
    path = url.pathname;
  } else {
    return null;
  }
  const m = /^\/blog\/([^/?#]+)\/?(?:[?#].*)?$/.exec(path);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).toLowerCase();
  } catch {
    return null;
  }
}

const statusOf = (post) => (post.published ? "published" : post.status === "planned" ? "planned" : "draft");
const brief = (post) => ({ id: String(post._id), title: post.title, slug: post.slug, status: statusOf(post) });

/**
 * posts: todos os posts, inclusive os da lixeira (deletedAt), com title slug
 * previousSlugs status published category tags relatedPosts season content views.
 * seasons: [{ slug, title }].
 */
function buildContentMap({ posts, seasons = [] }) {
  const live = posts.filter((p) => !p.deletedAt);
  const bySlug = new Map();
  const byOldSlug = new Map();
  const trashBySlug = new Map();
  for (const p of posts) {
    if (p.deletedAt) {
      trashBySlug.set(p.slug, p);
      continue;
    }
    bySlug.set(p.slug, p);
    for (const old of p.previousSlugs || []) byOldSlug.set(old, p);
  }
  const byId = new Map(live.map((p) => [String(p._id), p]));

  const nodes = [];
  const links = [];
  const brokenLinks = [];
  const inbound = new Map(live.map((p) => [String(p._id), 0]));
  const tagPosts = new Map();
  const seasonPosts = new Map();
  const seen = new Set();

  const addLink = (source, target, type) => {
    const key = `${type}:${source}>${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source, target, type });
  };

  for (const post of live) {
    const id = String(post._id);
    const publishedSource = statusOf(post) === "published";

    for (const slug of internalSlugs(post.content)) {
      const target = bySlug.get(slug);
      const href = `/blog/${slug}`;
      if (target) {
        if (String(target._id) === id) continue;
        addLink(id, String(target._id), "link");
        if (statusOf(target) === "published") {
          if (publishedSource) inbound.set(String(target._id), inbound.get(String(target._id)) + 1);
        } else {
          brokenLinks.push({ from: brief(post), href, reason: "unpublished", target: brief(target) });
        }
        continue;
      }
      const renamed = byOldSlug.get(slug);
      if (renamed) {
        if (String(renamed._id) !== id) {
          addLink(id, String(renamed._id), "link");
          if (publishedSource && statusOf(renamed) === "published") {
            inbound.set(String(renamed._id), inbound.get(String(renamed._id)) + 1);
          }
        }
        brokenLinks.push({ from: brief(post), href, reason: "old-slug", target: brief(renamed) });
        continue;
      }
      const trashed = trashBySlug.get(slug);
      brokenLinks.push({ from: brief(post), href, reason: trashed ? "trash" : "missing", target: trashed ? { title: trashed.title, slug } : null });
    }

    for (const relatedId of post.relatedPosts || []) {
      const target = byId.get(String(relatedId));
      if (!target || String(target._id) === id) continue;
      addLink(id, String(target._id), "related");
      if (publishedSource && statusOf(target) === "published") {
        inbound.set(String(target._id), inbound.get(String(target._id)) + 1);
      }
    }

    for (const tag of post.tags || []) {
      if (!tagPosts.has(tag)) tagPosts.set(tag, []);
      tagPosts.get(tag).push(post);
      addLink(id, `tag:${tag}`, "tag");
    }

    if (post.season) {
      if (!seasonPosts.has(post.season)) seasonPosts.set(post.season, 0);
      seasonPosts.set(post.season, seasonPosts.get(post.season) + 1);
      addLink(id, `season:${post.season}`, "season");
    }
  }

  // inbound = quantas ligações (texto ou leitura sugerida) chegam de outros publicados
  for (const post of live) {
    nodes.push({
      id: String(post._id),
      type: "post",
      label: post.title,
      slug: post.slug,
      status: statusOf(post),
      category: post.category,
      views: post.views || 0,
      inbound: inbound.get(String(post._id)) || 0,
    });
  }
  for (const [tag, list] of tagPosts) nodes.push({ id: `tag:${tag}`, type: "tag", label: `#${tag}`, count: list.length });
  const seasonTitles = new Map(seasons.map((s) => [s.slug, s.title]));
  for (const [slug, count] of seasonPosts) {
    nodes.push({ id: `season:${slug}`, type: "season", label: seasonTitles.get(slug) || slug, slug, count });
  }

  const orphans = live
    .filter((p) => statusOf(p) === "published" && !inbound.get(String(p._id)))
    .map(brief)
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));

  const singleTags = [...tagPosts]
    .filter(([, list]) => list.length === 1)
    .map(([tag, list]) => ({ tag, post: brief(list[0]) }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

  const published = live.filter((p) => statusOf(p) === "published").length;

  return {
    nodes,
    links,
    insights: {
      totals: {
        posts: live.length,
        published,
        tags: tagPosts.size,
        seasons: seasonPosts.size,
        internalLinks: links.filter((l) => l.type === "link").length,
      },
      orphans,
      brokenLinks,
      singleTags,
    },
  };
}

module.exports = { buildContentMap, internalSlugs };
