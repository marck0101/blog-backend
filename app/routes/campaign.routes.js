const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const campaign = require("../controllers/campaign.controller");

// Todas as rotas de envios são do admin
router.use(auth);

router.get("/", campaign.findAll);
router.post("/", campaign.create);
router.post("/audience-count", campaign.audienceCount);
router.get("/calendar", campaign.calendar);
router.post("/test-post", campaign.sendPostTest);
router.get("/:id", campaign.findOne);
router.patch("/:id", campaign.update);
router.delete("/:id", campaign.remove);
router.post("/:id/test", campaign.sendTest);
router.post("/:id/send", campaign.send);
router.post("/:id/duplicate", campaign.duplicate);
router.post("/:id/retry-failed", campaign.retryFailed);

module.exports = router;
