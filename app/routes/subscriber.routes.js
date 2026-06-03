const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const sub = require("../controllers/subscriber.controller");

// Públicas
router.post("/", sub.subscribe);
router.get("/unsubscribe/:token", sub.unsubscribe);

// Admin
router.get("/", auth, sub.findAll);
router.patch("/:id", auth, sub.update);
router.delete("/:id", auth, sub.remove);

module.exports = router;
