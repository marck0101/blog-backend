const mongoose = require("mongoose");
const { AREAS, STATUSES, DECISIONS } = require("../config/cockpitExperiments");

const score = { type: Number, required: true, min: 1, max: 5 };

// Registro de experimentos de crescimento (hipótese, ICE, variantes e resultado)
const ExperimentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    hypothesis: { type: String, required: true, trim: true, maxlength: 600 },
    area: { type: String, enum: AREAS, required: true },
    channel: { type: String, trim: true, maxlength: 80, default: "" },
    metric: { type: String, trim: true, maxlength: 120, default: "" },
    guardrailMetric: { type: String, trim: true, maxlength: 120, default: "" },
    ice: { impact: score, confidence: score, ease: score },
    // impacto × confiança × facilidade (1 a 125); recalculado ao salvar
    iceScore: { type: Number, default: 1, min: 1, max: 125 },
    minSample: { type: Number, default: null, min: 0 },
    plannedEnd: { type: Date, default: null },
    status: { type: String, enum: STATUSES, default: "ideia" },
    variants: {
      type: [{ _id: false, name: { type: String, required: true, trim: true, maxlength: 60 }, description: { type: String, trim: true, maxlength: 400, default: "" } }],
      default: [],
    },
    result: {
      summary: { type: String, trim: true, maxlength: 1000, default: "" },
      valueA: { type: Number, default: null },
      valueB: { type: Number, default: null },
      sample: { type: Number, default: null, min: 0 },
      decision: { type: String, enum: [...DECISIONS, null], default: null },
      learning: { type: String, trim: true, maxlength: 1000, default: "" },
    },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ExperimentSchema.pre("validate", function () {
  const { impact, confidence, ease } = this.ice || {};
  if (impact && confidence && ease) this.iceScore = impact * confidence * ease;
});

ExperimentSchema.index({ deletedAt: 1, status: 1, iceScore: -1 });

module.exports = mongoose.models.Experiment || mongoose.model("Experiment", ExperimentSchema);
