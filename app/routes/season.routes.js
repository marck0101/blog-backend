const express = require("express");
const router = express.Router();
const season = require("../controllers/season.controller");
const auth = require("../middlewares/auth.middleware");

/**
 * ================= ADMIN (PROTEGIDO) =================
 * Antes de /:slug para "admin" não ser lido como slug
 */
router.get("/admin", auth, season.adminList);
router.post("/", auth, season.create);
router.patch("/:id", auth, season.update);
router.delete("/:id", auth, season.remove);

/**
 * ================= BLOG PÚBLICO =================
 * Só seasons com episódio publicado
 */
router.get("/", season.publicList);
router.get("/:slug", season.publicOne);

module.exports = router;
