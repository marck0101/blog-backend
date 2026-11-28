const mongoose = require("mongoose");

// Registro de ações do admin (SEC-09). Quem fez o quê e quando; nunca o conteúdo.
// Some sozinho 365 dias depois (índice TTL em `at`). Regras: R-AUD-* no SISTEMA.md.
const ACTIONS = [
  "post.publish",
  "post.unpublish",
  "post.trash",
  "post.restore",
  "post.delete_permanent",
  "campaign.send",
  "campaign.retry",
  "subscriber.update",
  "subscriber.delete",
  "season.delete",
  "linkedin.share",
  "auth.login_success",
  "auth.login_failure",
];
const TARGET_TYPES = ["post", "campaign", "subscriber", "season", "auth"];
const RETENTION_DAYS = 365;

const AdminAuditLogSchema = new mongoose.Schema(
  {
    action: { type: String, enum: ACTIONS, required: true, index: true },
    // Quem fez. Vazio em login que falhou (ninguém foi identificado).
    actor: {
      userId: { type: String, default: null },
      email: { type: String, default: null },
    },
    // Em que mexeu: tipo, id e um rótulo curto (título/slug). Assinante: só o id.
    target: {
      type: { type: String, enum: TARGET_TYPES, default: null },
      id: { type: String, default: null },
      label: { type: String, default: null },
    },
    ipHash: { type: String, default: null }, // HMAC do IP, nunca o IP
    userAgent: { type: String, default: null }, // até 120 caracteres
    at: { type: Date, default: Date.now },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { versionKey: false }
);

AdminAuditLogSchema.index({ at: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 });

const AdminAuditLog = mongoose.models.AdminAuditLog || mongoose.model("AdminAuditLog", AdminAuditLogSchema);
AdminAuditLog.ACTIONS = ACTIONS;
AdminAuditLog.TARGET_TYPES = TARGET_TYPES;
AdminAuditLog.RETENTION_DAYS = RETENTION_DAYS;

module.exports = AdminAuditLog;
