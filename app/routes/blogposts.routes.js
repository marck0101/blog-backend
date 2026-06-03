const express = require("express");
const router = express.Router();
const post = require("../controllers/blogpost.controller");
const auth = require("../middlewares/auth.middleware");

/**
 * ================= BLOG PÚBLICO =================
 */
router.get("/published", post.findAllPublished);
router.get("/public/:id", post.findPublicById);
router.get("/slug/:slug", post.findBySlug);

/**
 * ================= ADMIN (PROTEGIDO) =================
 */
router.post("/", auth, post.create);
router.get("/", auth, post.findAll);
router.get("/deleted/all", auth, post.findAllDeleted);

// Rotas específicas antes de /:id para evitar colisão
router.get("/calendar", auth, post.calendar);
router.get("/heatmap", auth, post.heatmap);
router.get("/today-planned", auth, post.todayPlanned);

router.get("/:id", auth, post.findOne);
router.put("/:id", auth, post.update);

/**
 * ================= IMAGENS =================
 */
router.delete("/:id/images", auth, post.removeImage);

/**
 * ================= LIXEIRA =================
 */
router.delete("/:id", auth, post.softDelete);
router.patch("/:id/restore", auth, post.restore);
router.delete("/:id/hard", auth, post.deletePermanent);

module.exports = router;
