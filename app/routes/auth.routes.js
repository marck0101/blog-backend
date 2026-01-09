module.exports = (app) => {
  const controller = require("../controllers/auth.controller");
  const router = require("express").Router();

  router.post("/login", controller.login);

  app.use("/api/auth", router);
};
