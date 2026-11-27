const MetricSnapshot = require("../models/metricSnapshot.model");
const PostDailyStat = require("../models/postDailyStat.model");
const Subscriber = require("../models/subscriber.model");
const EmailEvent = require("../models/emailEvent.model");
const BlogPost = require("../models/blogpost.model");
const SiteSettings = require("../models/siteSettings.model");
const { PLACAR_METRICS, PLACAR_ON_TARGET_BAND, PLACAR_WEEKS } = require("../config/cockpit");
const { lastWeeks } = require("../utils/weeks");

/**
 * Pessoas distintas (por envio) que abriram ou clicaram na semana. Robôs e pré-carregamento
 * (automated) ficam de fora; só contagem, nenhum dado de pessoa sai daqui.
 */
async function emailReach(type, startAt, endAt) {
  const rows = await EmailEvent.aggregate([
    { $match: { type, automated: { $ne: true }, at: { $gte: startAt, $lte: endAt } } },
    { $group: { _id: { c: "$campaign", s: "$subscriber" } } },
    { $count: "n" },
  ]);
  return rows[0]?.n || 0;
}

/** abaixo (<90% da meta) · na_meta (90% a 110%) · acima (>110%); sem meta ou sem dado, o motivo */
function compare(value, meta) {
  if (!Number.isFinite(value)) return "sem_dados";
  if (!Number.isFinite(meta) || meta <= 0) return "sem_meta";
  const ratio = value / meta;
  if (ratio < 1 - PLACAR_ON_TARGET_BAND) return "abaixo";
  if (ratio > 1 + PLACAR_ON_TARGET_BAND) return "acima";
  return "na_meta";
}

async function readMetas() {
  const doc = await SiteSettings.findOne({ key: "site" }).select("cockpitPlacarMetas").lean();
  return doc?.cockpitPlacarMetas || {};
}

async function saveMetas(metas, userId) {
  const set = {};
  const unset = {};
  for (const [k, v] of Object.entries(metas)) {
    if (v === null) unset[`cockpitPlacarMetas.${k}`] = "";
    else set[`cockpitPlacarMetas.${k}`] = v;
  }
  const update = { ...(Object.keys(set).length ? { $set: { ...set, updatedBy: userId } } : { $set: { updatedBy: userId } }) };
  if (Object.keys(unset).length) update.$unset = unset;
  await SiteSettings.findOneAndUpdate({ key: "site" }, update, { upsert: true, setDefaultsOnInsert: true });
  return readMetas();
}

// Valores de cada número em cada semana (null = sem dado)
async function valuesByWeek(weeks) {
  const weekKeys = weeks.map((w) => w.key);
  const months = [...new Set(weeks.map((w) => w.month))];
  const snapKeys = PLACAR_METRICS.filter((m) => m.kind !== "blog").map((m) => m.key);
  const snaps = await MetricSnapshot.find({ key: { $in: snapKeys }, period: { $in: [...weekKeys, ...months] } })
    .select("source key period value")
    .lean();
  const snap = new Map(snaps.map((s) => [`${s.source}|${s.key}|${s.period}`, s.value]));

  const blog = await Promise.all(
    weeks.map(async (w) => {
      const dayFrom = w.start;
      const dayTo = w.end;
      const [posts, novos, views, aberturas, cliques] = await Promise.all([
        BlogPost.countDocuments({ published: true, deletedAt: null, publishedAt: { $gte: w.startAt, $lte: w.endAt } }),
        Subscriber.countDocuments({ createdAt: { $gte: w.startAt, $lte: w.endAt } }),
        PostDailyStat.aggregate([
          { $match: { day: { $gte: dayFrom, $lte: dayTo } } },
          { $group: { _id: null, views: { $sum: "$views" } } },
        ]),
        emailReach("open", w.startAt, w.endAt),
        emailReach("click", w.startAt, w.endAt),
      ]);
      return { posts_publicados: posts, inscritos_novos: novos, leituras: views[0]?.views || 0, aberturas_email: aberturas, cliques_email: cliques };
    })
  );

  return weeks.map((w, i) => {
    const out = {};
    for (const m of PLACAR_METRICS) {
      if (m.kind === "blog") out[m.key] = blog[i][m.key];
      else {
        const v = snap.get(`${m.source}|${m.key}|${m.kind === "month" ? w.month : w.key}`);
        out[m.key] = Number.isFinite(v) ? v : null;
      }
    }
    return out;
  });
}

async function buildPlacar(now = new Date()) {
  const weeks = lastWeeks(now, PLACAR_WEEKS);
  const [values, metas] = await Promise.all([valuesByWeek(weeks), readMetas()]);
  const numeros = PLACAR_METRICS.map((m) => {
    const meta = Number.isFinite(metas[m.key]) ? metas[m.key] : null;
    const serie = weeks.map((w, i) => ({
      week: w.key,
      start: w.start,
      end: w.end,
      current: w.current,
      value: values[i][m.key],
      status: compare(values[i][m.key], meta),
    }));
    const current = serie[serie.length - 1];
    return { key: m.key, label: m.label, unit: m.unit, kind: m.kind, source: m.source, meta, current, previous: serie[serie.length - 2], serie };
  });
  return { generatedAt: now, tz: "America/Sao_Paulo", weeks: weeks.map(({ key, start, end, current }) => ({ key, start, end, current })), numeros };
}

module.exports = { emailReach, buildPlacar, readMetas, saveMetas, compare };
