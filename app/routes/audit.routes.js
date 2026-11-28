const express = require("express");
const router = express.Router();
const connectDB = require("../config/db.config");
const auth = require("../middlewares/auth.middleware");
const AdminAuditLog = require("../models/adminAuditLog.model");
const { validate } = require("../validation/validate");
const { listQuery } = require("../validation/audit.schemas");
const { dayRangeFilter } = require("../utils/dates");

// Registro de ações do admin (SEC-09). Só leitura: nada aqui altera ou apaga.
router.get("/", auth, validate({ query: listQuery }), async (req, res, next) => {
  try {
    await connectDB();
    // No Express 5 req.query não aceita troca: aplica os padrões/conversões do esquema aqui
    const { page, limit, action, from, to } = listQuery.parse(req.query);

    const filter = {};
    if (action) filter.action = action;
    const period = dayRangeFilter(from, to);
    if (period) filter.at = period;

    const [entries, total] = await Promise.all([
      AdminAuditLog.find(filter)
        .sort({ at: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AdminAuditLog.countDocuments(filter),
    ]);

    res.set("Cache-Control", "no-store");
    res.json({ entries, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
