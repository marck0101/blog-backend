const express = require("express");
const router = express.Router();
const publicPosts = require("../controllers/posts/post.public.controller");
const adminPosts = require("../controllers/posts/post.admin.controller");
const revisions = require("../controllers/posts/post.revisions.controller");
const showcase = require("../controllers/posts/post.showcase.controller");
const auth = require("../middlewares/auth.middleware");
const { requireAllowedOrigin } = require("../middlewares/auth.middleware");
const { validate } = require("../validation/validate");
const { postBody, pinnedBody, highlightBody, removeImageBody, engageBody } = require("../validation/posts.schemas");

/**
 * ================= BLOG PÚBLICO =================
 */
router.get("/published", publicPosts.findAllPublished);
router.get("/public/:id", publicPosts.findPublicById);
router.get("/public/:id/related", publicPosts.findRelated);
router.get("/slug/:slug", publicPosts.findBySlug);
router.get("/season/:season", publicPosts.findSeasonEpisodes);
router.get("/pinned", publicPosts.findPinned);
router.get("/highlights", publicPosts.findHighlights);
router.post("/public/:id/engage", requireAllowedOrigin, validate({ body: engageBody }), publicPosts.engage);

/**
 * ================= ADMIN (PROTEGIDO) =================
 */
router.post("/", auth, validate({ body: postBody }), adminPosts.create);
router.get("/", auth, adminPosts.findAll);
router.get("/deleted/all", auth, adminPosts.findAllDeleted);

// Rotas específicas antes de /:id para evitar colisão
router.get("/calendar", auth, adminPosts.calendar);
router.get("/heatmap", auth, adminPosts.heatmap);
router.get("/today-planned", auth, adminPosts.todayPlanned);
router.get("/showcase", auth, showcase.showcase);
router.get("/tags", auth, adminPosts.tags);
router.put("/showcase/pinned", auth, validate({ body: pinnedBody }), showcase.setPinned);
router.patch("/:id/highlight", auth, validate({ body: highlightBody }), showcase.setHighlight);

router.get("/:id", auth, adminPosts.findOne);
router.put("/:id", auth, validate({ body: postBody }), adminPosts.update);

/**
 * ================= HISTÓRICO DE VERSÕES =================
 */
router.get("/:id/revisions", auth, revisions.listRevisions);
router.get("/:id/revisions/:version", auth, revisions.getRevision);
router.post("/:id/revisions/:version/restore", auth, revisions.restoreRevision);

/**
 * ================= IMAGENS =================
 */
router.delete("/:id/images", auth, validate({ body: removeImageBody }), adminPosts.removeImage);

/**
 * ================= LIXEIRA =================
 */
router.delete("/:id", auth, adminPosts.softDelete);
router.patch("/:id/restore", auth, adminPosts.restore);
router.delete("/:id/hard", auth, adminPosts.deletePermanent);

module.exports = router;
