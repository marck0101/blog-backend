const express = require("express");
const router = express.Router();
const cluster = require("../controllers/cluster.controller");

// Temas (clusters) do blog — R-CLU-01..03. Só leitura: a lista vem do config.
router.get("/", cluster.list);
router.get("/:slug", cluster.publicOne);

module.exports = router;
