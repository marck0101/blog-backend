const mongoose = require("mongoose");
const { JOB_RUN_TTL_DAYS } = require("../config/cockpit");

// Uma execução de rotina (sinal de vida). Apagada sozinha após 90 dias.
const JobRunSchema = new mongoose.Schema(
  {
    job: { type: String, required: true, maxlength: 40 },
    status: { type: String, enum: ["start", "ok", "fail"], required: true },
    startedAt: { type: Date, required: true, default: () => new Date() },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
    items: { type: Number, default: null },
    error: { type: String, maxlength: 500, default: null },
  },
  { versionKey: false }
);

JobRunSchema.index({ job: 1, startedAt: -1 });
JobRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: JOB_RUN_TTL_DAYS * 24 * 60 * 60 });

module.exports = mongoose.models.JobRun || mongoose.model("JobRun", JobRunSchema);
