const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const connectDB = require("../config/db.config");
const MetricSnapshot = require("../models/metricSnapshot.model");
const JobDefinition = require("../models/jobDefinition.model");
const CockpitNonce = require("../models/cockpitNonce.model");
const SiteSettings = require("../models/siteSettings.model");
const { validate } = require("../validation/validate");
const schemas = require("../validation/cockpit.schemas");
const { blockedFor, hit, tooMany } = require("../services/ratelimit.service");
const { buildHoje, readMeta } = require("../services/cockpitHoje.service");
const { ensureDefaultJobs, recordRun, jobStates } = require("../services/cockpitJobs.service");
const { signBody, signatureMatches, timestampInWindow, containsPii } = require("../utils/cockpitSecurity");
const { errorBody } = require("../utils/http");
const cfg = require("../config/cockpit");

/**
 * Entrada máquina a máquina (prospecção, benchmark, relatórios): sem sessão.
 * Cabeçalhos: x-cockpit-source, x-cockpit-timestamp (segundos) e
 * x-cockpit-signature = HMAC-SHA256 hex de "<timestamp>.<corpo cru>" com o
 * segredo da fonte (variável de ambiente). Ordem: limite de pedidos, tamanho,
 * fonte/segredo, janela de tempo, assinatura, repetição.
 */
async function machineAuth(req, res, next) {
  try {
    await connectDB();
    const wait = await blockedFor("cockpit-machine", req, cfg.MAX_REQUESTS_PER_MINUTE);
    if (wait) return tooMany(res, wait);
    await hit("cockpit-machine", req, 1);

    const raw = req.rawBody;
    if (!raw || !raw.length) return res.status(400).json(errorBody("Corpo JSON obrigatório"));
    if (raw.length > cfg.MAX_BODY_BYTES) return res.status(413).json(errorBody("Corpo grande demais (máx. 32 KB)"));

    const source = req.headers["x-cockpit-source"];
    const envName = cfg.INGEST_SECRET_ENV[source];
    if (!envName) return res.status(400).json(errorBody("Fonte desconhecida"));
    const secret = process.env[envName];
    if (!secret) return res.status(503).json(errorBody("Fonte não configurada"));

    const timestamp = req.headers["x-cockpit-timestamp"];
    if (!timestampInWindow(timestamp)) return res.status(401).json(errorBody("Timestamp fora da janela"));

    const signature = req.headers["x-cockpit-signature"];
    if (!signatureMatches(signBody(secret, timestamp, raw), signature)) {
      return res.status(401).json(errorBody("Assinatura inválida"));
    }

    try {
      await CockpitNonce.create({
        sig: String(signature).toLowerCase(),
        expiresAt: new Date(Date.now() + (cfg.TIMESTAMP_WINDOW_SEC * 2 + 60) * 1000),
      });
    } catch (err) {
      if (err.code === 11000) return res.status(401).json(errorBody("Requisição repetida"));
      throw err;
    }
    req.cockpitSource = source;
    next();
  } catch (err) {
    next(err);
  }
}

// Dado de pessoa em qualquer campo: recusa tudo (nada é gravado)
function rejectPii(req, res, next) {
  if (containsPii(req.body)) return res.status(422).json(errorBody("Dados de pessoa não são aceitos"));
  next();
}

router.post("/ingest", machineAuth, rejectPii, async (req, res, next) => {
  try {
    const parsed = schemas.ingestBody.safeParse(req.body);
    if (!parsed.success) return res.status(422).json(errorBody(parsed.error.issues[0].message));
    const { items } = parsed.data;
    const forbidden = schemas.firstForbiddenKey(req.cockpitSource, items);
    if (forbidden !== null) return res.status(422).json(errorBody(`Chave não permitida para ${req.cockpitSource}: ${forbidden}`));

    const now = new Date();
    await MetricSnapshot.bulkWrite(
      items.map((i) => ({
        updateOne: {
          filter: { source: req.cockpitSource, key: i.key, period: i.period },
          update: { $set: { value: i.value, meta: i.meta, capturedAt: now } },
          upsert: true,
        },
      }))
    );
    res.json({ accepted: items.length });
  } catch (err) {
    next(err);
  }
});

router.post("/heartbeat/:job", machineAuth, rejectPii, validate({ params: schemas.jobParams }), async (req, res, next) => {
  try {
    const parsed = schemas.heartbeatBody.safeParse(req.body);
    if (!parsed.success) return res.status(422).json(errorBody(parsed.error.issues[0].message));
    await ensureDefaultJobs();
    const def = await JobDefinition.findOne({ job: req.params.job }).lean();
    if (!def) return res.status(404).json(errorBody("Rotina desconhecida"));
    // Cada fonte só dá sinal de vida das próprias rotinas
    if (def.source !== req.cockpitSource) return res.status(403).json(errorBody("Rotina de outra fonte"));
    await recordRun(def.job, parsed.data);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ===== Painel (sessão + 2º fator) =====

router.get("/hoje", auth, async (req, res, next) => {
  try {
    await connectDB();
    res.set("Cache-Control", "no-store");
    res.json(await buildHoje());
  } catch (err) {
    next(err);
  }
});

router.get("/jobs", auth, async (req, res, next) => {
  try {
    await connectDB();
    res.set("Cache-Control", "no-store");
    res.json({ jobs: await jobStates() });
  } catch (err) {
    next(err);
  }
});

router.post("/jobs", auth, validate({ body: schemas.jobCreateBody }), async (req, res, next) => {
  try {
    await connectDB();
    const doc = await JobDefinition.create({ graceSec: 0, ...req.body });
    res.status(201).json({ job: doc });
  } catch (err) {
    next(err);
  }
});

router.put("/jobs/:job", auth, validate({ params: schemas.jobParams, body: schemas.jobUpdateBody }), async (req, res, next) => {
  try {
    await connectDB();
    const doc = await JobDefinition.findOneAndUpdate({ job: req.params.job }, { $set: req.body }, { returnDocument: "after", runValidators: true }).lean();
    if (!doc) return res.status(404).json(errorBody("Rotina não encontrada"));
    res.json({ job: doc });
  } catch (err) {
    next(err);
  }
});

router.get("/meta", auth, async (req, res, next) => {
  try {
    await connectDB();
    res.set("Cache-Control", "no-store");
    res.json({ valor: await readMeta() });
  } catch (err) {
    next(err);
  }
});

router.put("/meta", auth, validate({ body: schemas.metaBody }), async (req, res, next) => {
  try {
    await connectDB();
    await SiteSettings.findOneAndUpdate(
      { key: "site" },
      { $set: { cockpitMetaMensal: req.body.valor, updatedBy: req.userId } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ valor: req.body.valor });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
