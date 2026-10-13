const express = require("express");
const router = express.Router();
const connectDB = require("../config/db.config");
const auth = require("../middlewares/auth.middleware");
const linkedin = require("../services/linkedin.service");
const { SITE_URL } = require("../config/urls");

// Painel para onde o callback volta
const panelUrl = () =>
  process.env.NODE_ENV === "production" ? SITE_URL : process.env.CORS_DEV || "http://localhost:5173";

// { configured, connected, expired, name, picture, expiresAt, daysLeft }
router.get("/status", auth, async (req, res, next) => {
  try {
    await connectDB();
    res.json(await linkedin.getStatus());
  } catch (err) {
    next(err);
  }
});

// Devolve a URL de autorização; o painel redireciona o navegador para ela
router.get("/connect", auth, (req, res) => {
  if (!linkedin.isConfigured()) {
    return res.status(503).json({ error: "LINKEDIN_CLIENT_ID/SECRET/REDIRECT_URI não configurados" });
  }
  res.json({ url: linkedin.authorizationUrl(req.query.returnTo) });
});

// Público: o LinkedIn redireciona o navegador para cá. O state assinado
// (gerado em /connect, que exige login) é o que autentica.
router.get("/callback", async (req, res) => {
  let returnTo = "/admin/posts";
  try {
    returnTo = linkedin.verifyState(req.query.state);
    if (req.query.error) throw new Error(req.query.error_description || req.query.error);
    await connectDB();
    await linkedin.connectWithCode(req.query.code);
    res.redirect(`${panelUrl()}${returnTo}${returnTo.includes("?") ? "&" : "?"}linkedin=connected`);
  } catch (err) {
    console.error("[LINKEDIN] callback:", err.message);
    const msg = encodeURIComponent(err.message.slice(0, 150));
    res.redirect(`${panelUrl()}${returnTo}${returnTo.includes("?") ? "&" : "?"}linkedin=error&message=${msg}`);
  }
});

router.delete("/", auth, async (req, res, next) => {
  try {
    await connectDB();
    await linkedin.disconnect();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Publica agora (nova tentativa) o post de um artigo já publicado.
// body.force: o usuário conferiu que a tentativa interrompida não saiu.
router.post("/posts/:id/share", auth, async (req, res, next) => {
  try {
    await connectDB();
    const result = await linkedin.retryShare(req.params.id, { force: req.body?.force === true });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, needsConfirm: err.needsConfirm || false });
    }
    // Erro do LinkedIn: já ficou gravado no post
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
