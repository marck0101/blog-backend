const express = require("express");
const router = express.Router();
const connectDB = require("../config/db.config");
const { runDailyJobs } = require("../services/scheduler.service");
const { buildPlacar } = require("../services/cockpitPlacar.service");
const { buildHoje } = require("../services/cockpitHoje.service");
const { telegramConfig, buildMorningText, sendMorningSummary } = require("../services/cockpitTelegram.service");
const { recordRunSafe } = require("../services/cockpitJobs.service");

// A Vercel chama com "Authorization: Bearer <CRON_SECRET>" quando a
// variável CRON_SECRET existe no projeto. Sem ela, a rota fica fechada.
function cronAuth(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ error: "CRON_SECRET não configurado" });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Não autorizado" });
  }
  next();
}

router.get("/daily", cronAuth, async (req, res, next) => {
  try {
    await connectDB();
    // Sinal de vida para o Cockpit (por dentro, sem HTTP); falha ao registrar nunca derruba a rotina
    const JOB = "blog-cron-daily";
    const startedAt = Date.now();
    await recordRunSafe(JOB, { status: "start" });
    let summary;
    try {
      summary = await runDailyJobs();
    } catch (err) {
      await recordRunSafe(JOB, { status: "fail", durationMs: Date.now() - startedAt, error: err.message });
      throw err;
    }
    await recordRunSafe(JOB, {
      status: summary.errors?.length ? "fail" : "ok",
      durationMs: Date.now() - startedAt,
      items: summary.published?.length || 0,
      error: summary.errors?.[0],
    });
    // Resumo da manhã no Telegram: só números agregados; qualquer falha fica no resumo, nunca derruba o cron
    try {
      if (!telegramConfig()) summary.telegram = await sendMorningSummary("");
      else {
        const [placar, hoje] = await Promise.all([buildPlacar(), buildHoje()]);
        summary.telegram = await sendMorningSummary(buildMorningText({ placar, pendencias: hoje.acoes.items.length }));
      }
    } catch (err) {
      console.error("[cockpit] resumo da manhã:", err.message);
      summary.telegram = "falhou";
    }
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
