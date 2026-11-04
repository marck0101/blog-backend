const express = require("express");
const router = express.Router();
const season = require("../controllers/season.controller");
const auth = require("../middlewares/auth.middleware");
const { validate } = require("../validation/validate");
const { seasonBody } = require("../validation/seasons.schemas");

/**
 * ================= ADMIN (PROTEGIDO) =================
 * Antes de /:slug para "admin" não ser lido como slug
 */
router.get("/admin", auth, season.adminList);
router.post("/", auth, validate({ body: seasonBody }), season.create);
router.patch("/:id", auth, validate({ body: seasonBody }), season.update);
router.delete("/:id", auth, season.remove);

/**
 * ================= BLOG PÚBLICO =================
 * Só seasons com episódio publicado
 */
router.get("/", season.publicList);
router.get("/:slug", season.publicOne);

module.exports = router;
