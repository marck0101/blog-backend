const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const connectDB = require("../config/db.config");
const Subscriber = require("../models/subscriber.model");
const Campaign = require("../models/campaign.model");
const EmailEvent = require("../models/emailEvent.model");
const BlogPost = require("../models/blogpost.model");
const Comment = require("../models/comment.model");
const { engagementSummary } = require("../services/postStats.service");

router.use(auth);

const TZ = "America/Sao_Paulo";
const ratio = (a, b) => (b > 0 ? a / b : null);

// Canal da visita em que a pessoa assinou: UTM manda; sem UTM, o site de origem
const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|yandex)\./;
const SOCIAL = /(^|\.)(linkedin|lnkd|facebook|instagram|t\.co|twitter|x\.com|youtube|tiktok|threads|whatsapp|wa\.me)/;
function channelOf(source = {}) {
  const medium = (source.utmMedium || "").toLowerCase();
  const utm = (source.utmSource || "").toLowerCase();
  if (medium === "email" || utm === "newsletter") return "Email";
  if (["cpc", "paid", "ppc", "paid_social"].includes(medium)) return "Pago";
  if (medium === "social" || SOCIAL.test(utm)) return "Social";
  if (utm) return "Campanha (UTM)";
  const ref = (source.referrer || "").toLowerCase();
  if (!ref) return source.location ? "Direto" : "Sem registro";
  if (SEARCH.test(ref)) return "Busca orgânica";
  if (SOCIAL.test(ref)) return "Social";
  return "Outros sites";
}

function countBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

/**
 * Visão geral do período (?days=30): audiência, origem dos novos assinantes
 * e desempenho dos envios com rastreio.
 */
router.get("/overview", async (req, res, next) => {
  try {
    await connectDB();
    const days = Math.min(365, Math.max(7, parseInt(req.query.days) || 30));
    const since = new Date(Date.now() - days * 86400000);

    // Cancelados antes de existir unsubscribedAt: a última alteração é a melhor estimativa
    const unsubDate = { $ifNull: ["$unsubscribedAt", "$updatedAt"] };

    const [active, members, newSubs, unsubscribed, weeklyNew, weeklyUnsub, campaigns] = await Promise.all([
      Subscriber.countDocuments({ status: "active" }),
      Subscriber.countDocuments({ status: "active", tier: "member" }),
      Subscriber.find({ createdAt: { $gte: since } }, "source status createdAt").lean(),
      Subscriber.countDocuments({ status: "unsubscribed", $expr: { $gte: [unsubDate, since] } }),
      Subscriber.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateTrunc: { date: "$createdAt", unit: "week", timezone: TZ } }, count: { $sum: 1 } } },
      ]),
      Subscriber.aggregate([
        { $match: { status: "unsubscribed" } },
        { $addFields: { at: unsubDate } },
        { $match: { at: { $gte: since } } },
        { $group: { _id: { $dateTrunc: { date: "$at", unit: "week", timezone: TZ } }, count: { $sum: 1 } } },
      ]),
      Campaign.find({ tracking: true, startedAt: { $gte: since } })
        .select("subject kind status startedAt sentAt tracking post recipients")
        .sort({ startedAt: -1 }),
    ]);

    // Semanas do período, inclusive as sem movimento
    const weekMap = new Map();
    for (const w of weeklyNew) weekMap.set(w._id.toISOString(), { week: w._id, new: w.count, unsubscribed: 0 });
    for (const w of weeklyUnsub) {
      const key = w._id.toISOString();
      weekMap.set(key, { week: w._id, new: 0, ...weekMap.get(key), unsubscribed: w.count });
    }
    const weekly = [...weekMap.values()].sort((a, b) => a.week - b.week);

    // Base no início do período (aproximada: ignora quem entrou e saiu dentro dele)
    const newCount = newSubs.length;
    const activeAtStart = Math.max(active - newCount + unsubscribed, 0);

    // Origem dos novos
    const fromForm = newSubs.filter((s) => s.source?.location !== "manual");
    const bySlug = countBy(
      fromForm.filter((s) => s.source?.post),
      (s) => s.source.post
    );
    const posts = await BlogPost.find({ slug: { $in: bySlug.map((p) => p.key) } }, "title slug views").lean();
    const postBySlug = new Map(posts.map((p) => [p.slug, p]));

    const sources = {
      byChannel: countBy(newSubs, (s) => (s.source?.location === "manual" ? "Cadastro manual" : channelOf(s.source))),
      byLocation: countBy(fromForm, (s) => s.source?.location || "sem registro"),
      byUtmCampaign: countBy(
        fromForm.filter((s) => s.source?.utmCampaign),
        (s) => s.source.utmCampaign
      ).slice(0, 10),
      byPost: bySlug.slice(0, 10).map(({ key, count }) => {
        const post = postBySlug.get(key);
        return {
          slug: key,
          title: post?.title || key,
          signups: count,
          views: post?.views ?? null,
          // Sobre as visualizações totais do post (o contador não é por período)
          conversionRate: post?.views ? count / post.views : null,
        };
      }),
    };

    // Envios: totais e por envio
    const perCampaign = campaigns.map((c) => {
      const stats = c.stats();
      return {
        _id: c._id,
        subject: c.subject,
        kind: c.kind,
        status: c.status,
        startedAt: c.startedAt,
        delivered: stats.sent,
        opened: stats.opened,
        clicked: stats.clicked,
        unsubscribed: stats.unsubscribed,
        openRate: stats.openRate,
        clickRate: stats.clickRate,
        clickToOpenRate: stats.clickToOpenRate,
        unsubscribeRate: stats.unsubscribeRate,
      };
    });
    const sum = (field) => perCampaign.reduce((acc, c) => acc + c[field], 0);
    const delivered = sum("delivered");
    const opened = sum("opened");
    const clicked = sum("clicked");

    const topLinks = await EmailEvent.aggregate([
      { $match: { type: "click", automated: false, campaign: { $in: campaigns.map((c) => c._id) } } },
      { $group: { _id: "$url", clicks: { $sum: 1 }, people: { $addToSet: "$subscriber" } } },
      { $project: { _id: 0, url: "$_id", clicks: 1, uniqueClicks: { $size: "$people" } } },
      { $sort: { uniqueClicks: -1, clicks: -1 } },
      { $limit: 10 },
    ]);

    res.json({
      days,
      since,
      audience: {
        active,
        members,
        newSubscribers: newCount,
        unsubscribed,
        netGrowth: newCount - unsubscribed,
        growthRate: ratio(newCount - unsubscribed, activeAtStart),
        churnRate: ratio(unsubscribed, activeAtStart),
        weekly,
      },
      sources,
      email: {
        campaigns: perCampaign.length,
        delivered,
        opened,
        clicked,
        unsubscribed: sum("unsubscribed"),
        openRate: ratio(opened, delivered),
        clickRate: ratio(clicked, delivered),
        clickToOpenRate: ratio(clicked, opened),
        unsubscribeRate: ratio(sum("unsubscribed"), delivered),
        perCampaign,
        topLinks,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Detalhe de um envio: cliques por link, aberturas ao longo do tempo e automáticos descartados */
router.get("/campaigns/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    await connectDB();
    const id = new mongoose.Types.ObjectId(req.params.id);

    const [links, timeline, automated] = await Promise.all([
      EmailEvent.aggregate([
        { $match: { campaign: id, type: "click", automated: false } },
        { $group: { _id: "$url", clicks: { $sum: 1 }, people: { $addToSet: "$subscriber" } } },
        { $project: { _id: 0, url: "$_id", clicks: 1, uniqueClicks: { $size: "$people" } } },
        { $sort: { uniqueClicks: -1, clicks: -1 } },
      ]),
      // Primeira abertura de cada pessoa, por dia
      EmailEvent.aggregate([
        { $match: { campaign: id, type: { $in: ["open", "click"] }, automated: false } },
        { $group: { _id: "$subscriber", first: { $min: "$at" } } },
        { $group: { _id: { $dateTrunc: { date: "$first", unit: "day", timezone: TZ } }, opens: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, day: "$_id", opens: 1 } },
      ]),
      EmailEvent.countDocuments({ campaign: id, automated: true }),
    ]);

    res.json({ links, timeline, automated });
  } catch (err) {
    next(err);
  }
});

/**
 * Engajamento do leitor no período (?days=30): favoritos, compartilhamentos
 * por canal, visitas que chegaram por link compartilhado e comentários.
 */
router.get("/engagement", async (req, res, next) => {
  try {
    await connectDB();
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
    const since = new Date(Date.now() - days * 86400000);

    const [summary, comments] = await Promise.all([
      engagementSummary(days),
      Comment.aggregate([
        { $match: { createdAt: { $gte: since }, isAuthor: false } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);
    const byStatus = Object.fromEntries(comments.map((c) => [c._id, c.count]));

    res.json({
      ...summary,
      comments: {
        total: comments.reduce((n, c) => n + c.count, 0),
        pending: byStatus.pending || 0,
        approved: byStatus.approved || 0,
        rejected: byStatus.rejected || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
