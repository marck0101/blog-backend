const MetricSnapshot = require("../models/metricSnapshot.model");
const PostDailyStat = require("../models/postDailyStat.model");
const Subscriber = require("../models/subscriber.model");
const SiteSettings = require("../models/siteSettings.model");
const { dayKey, addDays, monthRange } = require("../utils/dates");
const { DEFAULT_META_MENSAL } = require("../config/cockpit");
const { pacing, daysInMonth } = require("./cockpitPacing.service");
const { jobStates } = require("./cockpitJobs.service");
const { overdueRunning } = require("./cockpitExperiments.service");
const Experiment = require("../models/experiment.model");

const SNAPSHOT_STALE_SEC = 2 * 86400;

// Meta mensal: valor salvo no painel > COCKPIT_META_MENSAL > 15000
async function readMeta() {
  const doc = await SiteSettings.findOne({ key: "site" }).select("cockpitMetaMensal").lean();
  if (typeof doc?.cockpitMetaMensal === "number") return doc.cockpitMetaMensal;
  const fromEnv = Number(process.env.COCKPIT_META_MENSAL);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_META_MENSAL;
}

// Último retrato de uma chave (período mais recente)
const latest = (source, key, period) =>
  MetricSnapshot.findOne({ source, key, ...(period ? { period } : {}) })
    .sort({ period: -1, capturedAt: -1 })
    .lean();

async function viewsBetween(from, to) {
  const [row] = await PostDailyStat.aggregate([
    { $match: { day: { $gte: from, $lte: to } } },
    { $group: { _id: null, views: { $sum: "$views" } } },
  ]);
  return row?.views || 0;
}

async function buildHoje(now = new Date()) {
  const today = dayKey(now);
  const [y, m, d] = today.split("-").map(Number);
  const monthPeriod = today.slice(0, 7);

  const [meta, receitaSnap, contatos, respostas, reunioes, jobs] = await Promise.all([
    readMeta(),
    latest("prospect0101", "receita_mes", monthPeriod),
    latest("prospect0101", "contatos_semana"),
    latest("prospect0101", "respostas_semana"),
    latest("prospect0101", "reunioes_semana"),
    jobStates(now),
  ]);

  const receita = {
    ...pacing({ accumulated: receitaSnap?.value ?? null, meta, day: d, daysInMonth: daysInMonth(y, m) }),
    period: monthPeriod,
    source: "prospect0101",
    updatedAt: receitaSnap?.capturedAt || null,
    staleAfterSec: SNAPSHOT_STALE_SEC,
  };

  const snaps = [contatos, respostas, reunioes].filter(Boolean);
  const prospeccao = {
    contatos: contatos?.value ?? null,
    respostas: respostas?.value ?? null,
    reunioes: reunioes?.value ?? null,
    period: snaps[0]?.period || null,
    hasData: snaps.length > 0,
    source: "prospect0101",
    updatedAt: snaps.map((s) => s.capturedAt).sort((a, b) => b - a)[0] || null,
    staleAfterSec: SNAPSHOT_STALE_SEC,
  };

  const { start: monthStart } = monthRange(now);
  const [views7d, viewsPrev7d, ativos, novosMes] = await Promise.all([
    viewsBetween(addDays(today, -6), today),
    viewsBetween(addDays(today, -13), addDays(today, -7)),
    Subscriber.countDocuments({ status: "active" }),
    Subscriber.countDocuments({ createdAt: { $gte: monthStart } }),
  ]);
  const live = { source: "blog", updatedAt: now, staleAfterSec: null };
  const leituras = {
    views7d,
    viewsPrev7d,
    variacaoPct: viewsPrev7d > 0 ? Math.round(((views7d - viewsPrev7d) / viewsPrev7d) * 1000) / 10 : null,
    ...live,
  };
  const inscritos = { ativos, novosMes, ...live };

  const count = (status) => jobs.filter((j) => j.status === status).length;
  const automacoes = {
    ok: count("ok"),
    rodando: count("rodando"),
    atrasada: count("atrasada"),
    falhou: count("falhou"),
    jobs,
    source: "cockpit",
    updatedAt: now,
    staleAfterSec: null,
  };

  const items = [];
  if (receita.status === "fora") {
    items.push({ id: "receita", title: "Receita abaixo do ritmo", detail: `${receita.pctOfExpected}% do esperado até hoje` });
  }
  for (const j of jobs) {
    if (j.status === "falhou") items.push({ id: `job-${j.job}`, title: `${j.label} falhou`, detail: j.lastError || "Última execução terminou com erro" });
    else if (j.status === "atrasada") items.push({ id: `job-${j.job}`, title: `${j.label} atrasada`, detail: j.neverRan ? "Ainda não deu sinal de vida" : "Passou do prazo esperado" });
  }

  const overdue = await overdueRunning(Experiment, now);
  if (overdue.length) {
    items.push({
      id: "experimentos-vencidos",
      title: `Experimentos rodando: ${overdue.length} passou do prazo`,
      detail: overdue.map((e) => e.title).slice(0, 3).join(", "),
      count: overdue.length,
    });
  }

  return {
    generatedAt: now,
    receita,
    prospeccao,
    leituras,
    inscritos,
    automacoes,
    acoes: { items, source: "cockpit", updatedAt: now, staleAfterSec: null },
  };
}

module.exports = { buildHoje, readMeta };
