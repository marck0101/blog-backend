const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const sub = require("../controllers/subscriber.controller");
const { validate } = require("../validation/validate");
const { subscribeBody, unsubscribeBody, manualBody, updateBody, listQuery } = require("../validation/subscribers.schemas");

// Públicas
router.post("/", validate({ body: subscribeBody }), sub.subscribe);
// GET só leva à página de confirmação; quem cancela é o POST (SEC-03)
router.get("/unsubscribe/:token", sub.unsubscribePage);
router.post("/unsubscribe/:token", validate({ body: unsubscribeBody }), sub.unsubscribe);

// Admin
router.get("/", auth, validate({ query: listQuery }), sub.findAll);
router.get("/export.csv", auth, validate({ query: listQuery }), sub.exportCsv);
router.post("/manual", auth, validate({ body: manualBody }), sub.createManual);
router.patch("/:id", auth, validate({ body: updateBody }), sub.update);
router.delete("/:id", auth, sub.remove);

module.exports = router;
