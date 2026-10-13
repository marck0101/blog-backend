const mongoose = require("mongoose");
const crypto = require("crypto");

const SubscriberSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      trim: true,
    },
    categories: {
      type: [String],
      default: [],
    },
    // "member" recebe os envios exclusivos; "free" só as notificações de novos posts
    tier: {
      type: String,
      enum: ["free", "member"],
      default: "free",
    },
    memberSince: {
      type: Date,
      default: null,
    },
    // Anotação interna do admin (ex.: "pagou via Pix em 10/2026")
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "unsubscribed"],
      default: "active",
    },
    token: {
      type: String,
    },
    confirmedAt: {
      type: Date,
      default: Date.now,
    },
    unsubscribedAt: { type: Date, default: null },
    // Envio cujo link de cancelamento foi usado
    unsubscribeCampaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", default: null },

    // De onde veio a inscrição (formulário do blog). "manual" = cadastrado pelo admin.
    source: {
      location: { type: String, default: "" }, // home | post | manual
      path: { type: String, default: "" }, // página do formulário
      post: { type: String, default: "" }, // slug, quando assinou num post
      landingPath: { type: String, default: "" }, // primeira página da visita
      referrer: { type: String, default: "" }, // domínio de origem da visita
      utmSource: { type: String, default: "" },
      utmMedium: { type: String, default: "" },
      utmCampaign: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

SubscriberSchema.index({ email: 1 });
SubscriberSchema.index({ token: 1 });
SubscriberSchema.index({ status: 1, tier: 1 });
SubscriberSchema.index({ createdAt: 1 });

SubscriberSchema.pre("save", function (next) {
  if (!this.token) {
    this.token = crypto.randomBytes(32).toString("hex");
  }
  next();
});

module.exports = mongoose.model("Subscriber", SubscriberSchema);
