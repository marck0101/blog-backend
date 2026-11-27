const JobRun = require("../models/jobRun.model");
const JobDefinition = require("../models/jobDefinition.model");
const { DEFAULT_JOBS } = require("../config/cockpit");

// "Rodando" só vale para um início recente; início antigo sem fim não segura o status
const RUNNING_MAX_MS = 30 * 60 * 1000;

// Cria as rotinas padrão que ainda não existem (não mexe nas que já foram editadas)
async function ensureDefaultJobs() {
  await JobDefinition.bulkWrite(
    DEFAULT_JOBS.map((def) => ({ updateOne: { filter: { job: def.job }, update: { $setOnInsert: def }, upsert: true } }))
  );
}

/**
 * Registra um sinal de vida. start abre uma execução; ok/fail fecham a aberta
 * mais recente (ou criam uma já fechada, se não houver início recente).
 */
async function recordRun(job, { status, durationMs, items, error }, now = new Date()) {
  const hasDuration = Number.isFinite(durationMs);
  const extra = {
    items: Number.isFinite(items) ? items : null,
    error: error ? String(error).slice(0, 500) : null,
  };
  if (status === "start") return JobRun.create({ job, status: "start", startedAt: now });

  const open = await JobRun.findOne({
    job,
    status: "start",
    startedAt: { $gte: new Date(now.getTime() - RUNNING_MAX_MS) },
  }).sort({ startedAt: -1 });
  if (open) {
    open.status = status;
    open.finishedAt = now;
    open.durationMs = hasDuration ? durationMs : now.getTime() - open.startedAt.getTime();
    Object.assign(open, extra);
    return open.save();
  }
  return JobRun.create({
    job,
    status,
    startedAt: hasDuration ? new Date(now.getTime() - durationMs) : now,
    finishedAt: now,
    durationMs: hasDuration ? durationMs : 0,
    ...extra,
  });
}

// Uso interno (cron do blog): nunca derruba quem chama
async function recordRunSafe(job, data) {
  try {
    return await recordRun(job, data);
  } catch (err) {
    console.error("[cockpit] sinal de vida:", err.message);
    return null;
  }
}

const time = (r) => (r ? new Date(r.finishedAt || r.startedAt).getTime() : 0);

// Estado de uma rotina a partir da definição e das últimas execuções
function evaluateJob(def, { lastOk, lastFail, open }, now = new Date()) {
  const last = [lastOk, lastFail, open].filter(Boolean).sort((a, b) => time(b) - time(a))[0];
  let status;
  if (lastFail && time(lastFail) > time(lastOk)) status = "falhou";
  else if (open && now.getTime() - new Date(open.startedAt).getTime() < RUNNING_MAX_MS) status = "rodando";
  else if (!lastOk || now.getTime() > time(lastOk) + (def.expectedEverySec + (def.graceSec || 0)) * 1000) status = "atrasada";
  else status = "ok";
  return {
    job: def.job,
    label: def.label,
    status,
    expectedEverySec: def.expectedEverySec,
    graceSec: def.graceSec || 0,
    lastOkAt: lastOk ? lastOk.finishedAt : null,
    lastRunAt: last ? last.finishedAt || last.startedAt : null,
    lastError: lastFail && time(lastFail) > time(lastOk) ? lastFail.error : null,
    neverRan: !last,
  };
}

async function jobStates(now = new Date()) {
  await ensureDefaultJobs();
  const defs = await JobDefinition.find({}).sort({ job: 1 }).lean();
  return Promise.all(
    defs.map(async (def) => {
      const [lastOk, lastFail, open] = await Promise.all([
        JobRun.findOne({ job: def.job, status: "ok" }).sort({ finishedAt: -1 }).lean(),
        JobRun.findOne({ job: def.job, status: "fail" }).sort({ finishedAt: -1 }).lean(),
        JobRun.findOne({ job: def.job, status: "start" }).sort({ startedAt: -1 }).lean(),
      ]);
      return evaluateJob(def, { lastOk, lastFail, open }, now);
    })
  );
}

module.exports = { ensureDefaultJobs, recordRun, recordRunSafe, evaluateJob, jobStates, RUNNING_MAX_MS };
