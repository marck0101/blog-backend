const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const campaign = require("../controllers/campaign.controller");
const { validate } = require("../validation/validate");
const { campaignBody, testBody, testPostBody, duplicateBody, listQuery } = require("../validation/campaigns.schemas");

// Todas as rotas de envios são do admin
router.use(auth);

router.get("/", validate({ query: listQuery }), campaign.findAll);
router.post("/", validate({ body: campaignBody }), campaign.create);
router.post("/audience-count", campaign.audienceCount);
router.get("/calendar", campaign.calendar);
router.post("/test-post", validate({ body: testPostBody }), campaign.sendPostTest);
router.get("/:id", campaign.findOne);
router.patch("/:id", validate({ body: campaignBody }), campaign.update);
router.delete("/:id", campaign.remove);
router.post("/:id/test", validate({ body: testBody }), campaign.sendTest);
router.post("/:id/send", campaign.send);
router.post("/:id/duplicate", validate({ body: duplicateBody }), campaign.duplicate);
router.post("/:id/retry-failed", campaign.retryFailed);

module.exports = router;
