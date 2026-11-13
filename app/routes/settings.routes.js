const express = require("express");
const connectDB = require("../config/db.config");
const auth = require("../middlewares/auth.middleware");
const { validate } = require("../validation/validate");
const { featuresBody } = require("../validation/settings.schemas");
const SiteSettings = require("../models/siteSettings.model");
const { FEATURES, FEATURE_NAMES } = require("../config/features");

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

// ADMIN: liga/desliga um ou mais recursos ({ toc: false })
router.patch("/features", auth, validate({ body: featuresBody }), async (req, res, next) => {
  try {
    await connectDB();
    const $set = { updatedBy: req.userId };
    for (const [name, on] of Object.entries(req.body)) {
      if (typeof on === "boolean") $set[`features.${name}`] = on;
    }
    const doc = await SiteSettings.findOneAndUpdate({ key: "site" }, { $set }, { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }).lean();
    console.log("[settings] recursos:", JSON.stringify(req.body));
    res.set("Cache-Control", "no-store");
    res.json({ features: featuresOf(doc), updatedAt: doc.updatedAt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
