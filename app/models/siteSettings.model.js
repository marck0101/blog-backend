const mongoose = require("mongoose");
const { FEATURES } = require("../config/features");

// Configuração do site num documento só (key "site"). Hoje: os recursos do
// blog ligados/desligados pelo painel.
const featureFields = Object.fromEntries(
  Object.entries(FEATURES).map(([name, on]) => [name, { type: Boolean, default: on }])
);

const SiteSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "site" },
    features: { type: new mongoose.Schema(featureFields, { _id: false }), default: () => ({}) },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.SiteSettings || mongoose.model("SiteSettings", SiteSettingsSchema);
