module.exports = app => {
  const post = require("../controllers/blogpost.controller");
  const router = require("express").Router();

  /**
   * BLOG PÚBLICO (sempre primeiro)
   */
  router.get("/published", post.findAllPublished);
  router.get("/slug/:slug", post.findBySlug);

  /**
   * ADMIN
   */
  router.post("/", post.create);
  router.get("/", post.findAll);
  router.get("/deleted/all", post.findAllDeleted);
  router.get("/:id", post.findOne);
  router.put("/:id", post.update);

  /**
   * IMAGENS
   */
  router.delete("/:id/images", post.removeImage);

  /**
   * LIXEIRA
   */
  router.delete("/:id", post.softDelete);
  router.patch("/:id/restore", post.restore);
  router.delete("/:id/hard", post.deletePermanent);

  app.use("/api/posts", router);
};
