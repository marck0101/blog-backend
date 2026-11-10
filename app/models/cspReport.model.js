const mongoose = require("mongoose");

// Relatórios da CSP do site, agrupados (SEC-02). Um documento por combinação
// diretiva + recurso bloqueado + página, com quantas vezes apareceu. Os logs da
// Vercel (plano Hobby) somem em ~1 hora; aqui ficam 30 dias desde o último aviso.
const CspReportSchema = new mongoose.Schema(
  {
    directive: { type: String, default: "" },
    blocked: { type: String, default: "" },
    page: { type: String, default: "" },
    count: { type: Number, default: 0 },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

CspReportSchema.index({ directive: 1, blocked: 1, page: 1 }, { unique: true });
CspReportSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.models.CspReport || mongoose.model("CspReport", CspReportSchema);
