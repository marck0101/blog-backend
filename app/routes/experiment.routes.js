const express = require("express");
const router = express.Router();
const connectDB = require("../config/db.config");
const Experiment = require("../models/experiment.model");
const { toPublicActive } = require("../services/cockpitExperiments.service");

// Sorteio de variantes no site (Sprint R5). Público e só leitura: devolve apenas os experimentos
// rodando que têm alvo e variantes, e só chave/alvo/variantes (nada de hipótese, métrica, nota ou id).
router.get("/ativos", async (req, res, next) => {
  try {
    await connectDB();
    const docs = await Experiment.find({
      deletedAt: null,
      status: "rodando",
      alvo: { $ne: null },
      chave: { $type: "string" },
      "variantes.1": { $exists: true },
    })
      .select("chave alvo variantes")
      .sort({ startedAt: 1, createdAt: 1 })
      .lean();
    res.set("Cache-Control", "public, max-age=60, s-maxage=60");
    res.json(docs.map(toPublicActive));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
