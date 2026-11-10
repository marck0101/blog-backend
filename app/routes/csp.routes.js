const express = require("express");
const connectDB = require("../config/db.config");
const limiter = require("../services/ratelimit.service");

const router = express.Router();

// Relatórios da Content-Security-Policy do site (SEC-02, vercel.json do front).
// O navegador manda quando algo seria bloqueado. Vira uma linha "[CSP]" nos
// logs da Vercel; nada é gravado no banco.
// 30 relatórios por IP a cada 10 min: uma página com problema repete o mesmo aviso.
const REPORT_MAX = 30;
const REPORT_WINDOW_MIN = 10;

const parse = express.json({
  type: ["application/csp-report", "application/reports+json", "application/json"],
  limit: "20kb",
});

const text = (value) => (typeof value === "string" ? value.slice(0, 200) : "");
// Sem query string: pode carregar token ou dado pessoal
const noQuery = (url) => text(url).split(/[?#]/)[0];

// report-uri: { "csp-report": {...} } · Reporting API: [{ type, body: {...} }]
function reportsOf(body) {
  if (body?.["csp-report"]) return [body["csp-report"]];
  if (Array.isArray(body)) return body.filter((r) => r?.type === "csp-violation").map((r) => r.body || {});
  return [];
}

router.post("/", parse, async (req, res) => {
  try {
    await connectDB();
    const wait = await limiter.blockedFor("csp", req, REPORT_MAX);
    if (!wait) {
      await limiter.hit("csp", req, REPORT_WINDOW_MIN);
      for (const r of reportsOf(req.body).slice(0, 5)) {
        const directive = text(r["effective-directive"] || r["violated-directive"] || r.effectiveDirective);
        const blocked = noQuery(r["blocked-uri"] || r.blockedURL);
        const page = noQuery(r["document-uri"] || r.documentURL);
        console.warn(`[CSP] ${directive} bloquearia ${blocked || "(inline)"} em ${page}`);
      }
    }
  } catch (err) {
    console.error("[CSP] relatório:", err.message);
  }
  // Sempre 204: o navegador não faz nada com a resposta
  res.status(204).end();
});

module.exports = router;
