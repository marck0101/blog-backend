const mongoose = require("mongoose");
const BlogPost = require("../models/blogpost.model");
const PostDailyStat = require("../models/postDailyStat.model");

const TZ = "America/Sao_Paulo";
const SHARE_CHANNELS = ["whatsapp", "linkedin", "x", "facebook", "telegram", "email", "copy", "native"];
const HIGHLIGHT_DAYS = 7;
const HIGHLIGHT_LIMIT = 4;

// "YYYY-MM-DD" no fuso de Brasília (en-CA já formata assim)
function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(date);
}

// Dia de hoje menos (days - 1): "últimos 7 dias" inclui hoje
function sinceKey(days) {
  return dayKey(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));
}

function bump(postId, inc) {
  return PostDailyStat.updateOne({ post: postId, day: dayKey() }, { $inc: inc }, { upsert: true });
}

// Leitura do post (best-effort: estatística nunca derruba a página)
async function recordView(postId) {
  try {
    await bump(postId, { views: 1 });
  } catch (err) {
    if (err.code === 11000) return bump(postId, { views: 1 }).catch(() => {});
    console.error("[STATS] view:", err.message);
  }
}

/**
 * Evento do leitor: favorite | unfavorite | share | share_visit.
 * Devolve false quando o evento não é válido.
 */
async function recordEvent(postId, type, channel) {
  if ((type === "share" || type === "share_visit") && !SHARE_CHANNELS.includes(channel)) return false;

  let daily;
  if (type === "favorite") {
    daily = { favorites: 1 };
    await BlogPost.updateOne({ _id: postId }, { $inc: { favorites: 1 } }, { timestamps: false });
  } else if (type === "unfavorite") {
    daily = { unfavorites: 1 };
    // Nunca abaixo de zero (favorito salvo antes da contagem existir)
    await BlogPost.updateOne(
      { _id: postId, favorites: { $gt: 0 } },
      { $inc: { favorites: -1 } },
      { timestamps: false }
    );
  } else if (type === "share") {
    daily = { [`shares.${channel}`]: 1 };
    await BlogPost.updateOne({ _id: postId }, { $inc: { shares: 1 } }, { timestamps: false });
  } else if (type === "share_visit") {
    daily = { [`shareVisits.${channel}`]: 1 };
  } else {
    return false;
  }

  try {
    await bump(postId, daily);
  } catch (err) {
    if (err.code !== 11000) throw err;
    await bump(postId, daily);
  }
  return true;
}

// Leituras por post nos últimos `days` dias: [{ _id: postId, views }]
function viewsSince(days, extraMatch = {}) {
  return PostDailyStat.aggregate([
    { $match: { day: { $gte: sinceKey(days) }, ...extraMatch } },
    { $group: { _id: "$post", views: { $sum: "$views" } } },
    { $match: { views: { $gt: 0 } } },
    { $sort: { views: -1 } },
  ]);
}

/**
 * Ranking dos destaques da semana (só posts publicados):
 *   1. forçados no painel (mais recentes primeiro)
 *   2. mais lidos dos últimos 7 dias
 * Fixados ficam de fora (já aparecem na vitrine) e "esconder" nunca entra.
 * Devolve [{ post, views7d, reason: "force" | "auto" }].
 */
async function weeklyHighlights({ limit = HIGHLIGHT_LIMIT, fields = null } = {}) {
  const base = { published: true, deletedAt: null, pinnedOrder: null };

  const [forced, ranking] = await Promise.all([
    BlogPost.find({ ...base, highlight: "force" }).select(fields).sort({ publishedAt: -1 }).limit(limit).lean(),
    viewsSince(HIGHLIGHT_DAYS),
  ]);
  const viewsOf = new Map(ranking.map((r) => [String(r._id), r.views]));

  const result = forced.map((post) => ({ post, views7d: viewsOf.get(String(post._id)) || 0, reason: "force" }));
  const remaining = limit - result.length;
  if (remaining <= 0) return result;

  const taken = new Set(result.map((r) => String(r.post._id)));
  const candidateIds = ranking.map((r) => r._id).filter((id) => !taken.has(String(id)));
  if (!candidateIds.length) return result;

  // $nin em vez de "auto": posts criados antes do campo não o têm
  const candidates = await BlogPost.find({ ...base, _id: { $in: candidateIds }, highlight: { $nin: ["force", "hide"] } })
    .select(fields)
    .lean();
  const byId = new Map(candidates.map((p) => [String(p._id), p]));
  for (const id of candidateIds) {
    const post = byId.get(String(id));
    if (!post) continue;
    result.push({ post, views7d: viewsOf.get(String(id)), reason: "auto" });
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Engajamento no período, para o painel: totais, canais e posts que mais
 * receberam favoritos, compartilhamentos e visitas por compartilhamento.
 */
async function engagementSummary(days) {
  const since = sinceKey(days);
  const stats = await PostDailyStat.find({ day: { $gte: since } }).lean();

  const totals = { views: 0, favorites: 0, unfavorites: 0, shares: 0, shareVisits: 0 };
  const sharesByChannel = {};
  const visitsByChannel = {};
  const perPost = new Map();

  for (const s of stats) {
    const key = String(s.post);
    const row = perPost.get(key) || { views: 0, favorites: 0, unfavorites: 0, shares: 0, shareVisits: 0 };
    row.views += s.views || 0;
    row.favorites += s.favorites || 0;
    row.unfavorites += s.unfavorites || 0;
    for (const [channel, n] of Object.entries(s.shares || {})) {
      row.shares += n;
      sharesByChannel[channel] = (sharesByChannel[channel] || 0) + n;
    }
    for (const [channel, n] of Object.entries(s.shareVisits || {})) {
      row.shareVisits += n;
      visitsByChannel[channel] = (visitsByChannel[channel] || 0) + n;
    }
    perPost.set(key, row);
  }
  for (const row of perPost.values()) {
    for (const k of Object.keys(totals)) totals[k] += row[k];
  }

  const ids = [...perPost.keys()].filter((id) => mongoose.isValidObjectId(id));
  const posts = await BlogPost.find({ _id: { $in: ids } })
    .select("title slug favorites shares commentsCount published deletedAt")
    .lean();
  const postRows = posts
    .map((p) => ({
      id: p._id,
      title: p.title,
      slug: p.slug,
      published: p.published && !p.deletedAt,
      totalFavorites: p.favorites || 0,
      totalShares: p.shares || 0,
      comments: p.commentsCount || 0,
      ...perPost.get(String(p._id)),
    }))
    .filter((r) => r.favorites || r.unfavorites || r.shares || r.shareVisits || r.views);

  const toList = (map) =>
    Object.entries(map).map(([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count);

  return {
    days,
    totals,
    sharesByChannel: toList(sharesByChannel),
    visitsByChannel: toList(visitsByChannel),
    posts: postRows.sort((a, b) => b.shares + b.favorites + b.shareVisits - (a.shares + a.favorites + a.shareVisits)),
  };
}

module.exports = {
  SHARE_CHANNELS,
  HIGHLIGHT_DAYS,
  dayKey,
  recordView,
  recordEvent,
  viewsSince,
  weeklyHighlights,
  engagementSummary,
};
