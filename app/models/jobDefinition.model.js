const mongoose = require("mongoose");
const { SOURCES } = require("../config/cockpit");

// O que se espera de cada rotina: de quanto em quanto tempo deve dar sinal
// de vida e quanta folga se dá antes de chamar de "atrasada".
const JobDefinitionSchema = new mongoose.Schema(
  {
    job: { type: String, required: true, unique: true, match: /^[a-z0-9-]{1,40}$/ },
    label: { type: String, required: true, maxlength: 80 },
    // Quem pode enviar o sinal de vida por HTTP (a fonte "blog" registra por dentro)
    source: { type: String, enum: SOURCES, default: null },
    expectedEverySec: { type: Number, required: true, min: 60 },
    graceSec: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.models.JobDefinition || mongoose.model("JobDefinition", JobDefinitionSchema);
