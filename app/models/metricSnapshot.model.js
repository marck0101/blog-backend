const mongoose = require("mongoose");
const { SOURCES } = require("../config/cockpit");

// Retrato de um número num período, vindo de uma fonte (prospecção, benchmark,
// relatórios...). Um por (fonte, chave, período): reenviar atualiza o valor.
const MetricSnapshotSchema = new mongoose.Schema(
  {
    source: { type: String, enum: SOURCES, required: true },
    key: { type: String, required: true, maxlength: 60 }, // ex.: receita_mes
    period: { type: String, required: true, maxlength: 10 }, // 2026-11 | 2026-W48 | 2026-11-27
    value: { type: Number, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: undefined }, // pequeno e validado na entrada
    capturedAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false }
);

MetricSnapshotSchema.index({ source: 1, key: 1, period: 1 }, { unique: true });

module.exports = mongoose.models.MetricSnapshot || mongoose.model("MetricSnapshot", MetricSnapshotSchema);
