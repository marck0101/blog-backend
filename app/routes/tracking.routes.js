const express = require("express");
const router = express.Router();
const connectDB = require("../config/db.config");
const tracking = require("../services/tracking.service");
const { SITE_URL } = require("../config/urls");

// GIF transparente de 1x1
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

// Público (vem do email). Falha no registro nunca quebra a imagem nem o link.
router.get("/o/:campaign/:subscriber/:sig.gif", async (req, res) => {
  const { campaign, subscriber, sig } = req.params;
  if (tracking.verify(sig, campaign, subscriber)) {
    try {
      await connectDB();
      await tracking.record("open", campaign, subscriber, { userAgent: req.get("user-agent") });
    } catch (err) {
      console.error("[TRACK] open:", err.message);
    }
  }
  res.set({
    "Content-Type": "image/gif",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
  });
  res.end(PIXEL);
});

router.get("/c/:campaign/:subscriber/:sig", async (req, res) => {
  const { campaign, subscriber, sig } = req.params;
  const url = typeof req.query.u === "string" ? req.query.u : "";

  // Assinatura inválida: não redireciona para fora (evita redirecionador aberto)
  if (!/^https?:\/\//.test(url) || !tracking.verify(sig, campaign, subscriber, url)) {
    return res.redirect(302, SITE_URL);
  }

  try {
    await connectDB();
    await tracking.record("click", campaign, subscriber, { userAgent: req.get("user-agent"), url });
  } catch (err) {
    console.error("[TRACK] click:", err.message);
  }
  res.redirect(302, url);
});

module.exports = router;
