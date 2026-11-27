const mongoose = require("mongoose");
const { LINK_GROUPS } = require("../config/cockpitExperiments");

// Atalhos do painel (anúncios, analytics, sistemas...). Só https.
const CockpitLinkSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 80 },
    url: { type: String, required: true, trim: true, maxlength: 2000, match: /^https:\/\//i },
    group: { type: String, enum: LINK_GROUPS, default: "outros" },
    note: { type: String, trim: true, maxlength: 300, default: "" },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.models.CockpitLink || mongoose.model("CockpitLink", CockpitLinkSchema);
