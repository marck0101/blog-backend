const express = require("express");
const router = express.Router();
const connectDB = require("../config/db.config");
const { runDailyJobs } = require("../services/scheduler.service");

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
    res.json(await runDailyJobs());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
