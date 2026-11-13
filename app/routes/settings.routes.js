const express = require("express");
const connectDB = require("../config/db.config");
const auth = require("../middlewares/auth.middleware");
const { validate } = require("../validation/validate");
const { featuresBody } = require("../validation/settings.schemas");
const SiteSettings = require("../models/siteSettings.model");
const { FEATURES, FEATURE_NAMES } = require("../config/features");
const limiter = require("../services/ratelimit.service");
const { confirmAppCode, SecretUnreadable, secretUnreadable } = require("../services/mfa.service");
const { errorBody } = require("../utils/http");

// Mesmo limite do código no login: 5 erros em 15 minutos
const MFA_MAX = 5;
const MFA_WINDOW_MIN = 15;
const CODE_ERRORS = {
  wrong: "Código incorreto. Confira o app autenticador.",
  reused: "Esse código já foi usado. Espere o próximo aparecer no app (até 30 segundos).",
  "no-mfa": "Cadastre o app autenticador (Segurança) antes de mudar os recursos.",
};

const router = express.Router();

// Só os recursos conhecidos, com o padrão (ligado) no que faltar
function featuresOf(doc) {
  const saved = doc?.features || {};
  return Object.fromEntries(FEATURE_NAMES.map((name) => [name, typeof saved[name] === "boolean" ? saved[name] : FEATURES[name]]));
}

// PÚBLICO: o blog pergunta ao abrir. Cache curto na CDN: desligar no painel
// chega aos leitores em até ~1 minuto. Falha no banco = tudo no padrão (ligado).
router.get("/features", async (req, res) => {
  let features = { ...FEATURES };
  try {
    await connectDB();
    features = featuresOf(await SiteSettings.findOne({ key: "site" }).lean());
    res.set("Cache-Control", "public, max-age=30, s-maxage=30, stale-while-revalidate=30");
  } catch (err) {
    console.error("[settings] recursos:", err.message);
    res.set("Cache-Control", "no-store");
  }
  res.json({ features });
});

// ADMIN: estado atual, sem cache (o painel mostra o que acabou de salvar)
router.get("/features/admin", auth, async (req, res, next) => {
  try {
    await connectDB();
    const doc = await SiteSettings.findOne({ key: "site" }).lean();
    res.set("Cache-Control", "no-store");
    res.json({ features: featuresOf(doc), updatedAt: doc?.updatedAt || null });
  } catch (err) {
    next(err);
  }
});

// ADMIN: liga/desliga um ou mais recursos ({ toc: false, code: "123456" }).
// Dupla confirmação: só com o código do app autenticador. Código errado = 403
// (não 401, que no painel derruba a sessão).
router.patch("/features", auth, validate({ body: featuresBody }), async (req, res, next) => {
  try {
    await connectDB();
    const wait = await limiter.blockedFor("mfa", req, MFA_MAX);
    if (wait) return limiter.tooMany(res, wait);

    const check = await confirmAppCode(req.userId, req.body.code);
    if (!check.ok) {
      if (check.reason === "wrong") await limiter.hit("mfa", req, MFA_WINDOW_MIN);
      return res.status(403).json(errorBody(CODE_ERRORS[check.reason]));
    }
    await limiter.reset("mfa", req);

    const $set = { updatedBy: req.userId };
    for (const name of FEATURE_NAMES) {
      if (typeof req.body[name] === "boolean") $set[`features.${name}`] = req.body[name];
    }
    const doc = await SiteSettings.findOneAndUpdate({ key: "site" }, { $set }, { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }).lean();
    const changed = Object.fromEntries(FEATURE_NAMES.filter((n) => typeof req.body[n] === "boolean").map((n) => [n, req.body[n]]));
    console.log("[settings] recursos:", JSON.stringify(changed));
    res.set("Cache-Control", "no-store");
    res.json({ features: featuresOf(doc), updatedAt: doc.updatedAt });
  } catch (err) {
    if (err instanceof SecretUnreadable) return secretUnreadable(res);
    next(err);
  }
});

module.exports = router;
