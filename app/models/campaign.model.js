const mongoose = require("mongoose");

const AUDIENCE_TYPES = ["members", "all", "categories", "selected"];

const RecipientSchema = new mongoose.Schema(
  {
    subscriber: { type: mongoose.Schema.Types.ObjectId, ref: "Subscriber" },
    email: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
    error: String,
    sentAt: Date,
  },
  { _id: false }
);

const CampaignSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: [true, "O assunto é obrigatório"],
      trim: true,
    },
    // Texto curto que aparece ao lado do assunto na caixa de entrada
    preheader: { type: String, trim: true, default: "" },
    content: { type: String, default: "" },

    audience: {
      type: {
        type: String,
        enum: { values: AUDIENCE_TYPES, message: "Público inválido" },
        default: "members",
      },
      categories: { type: [String], default: [] },
      subscribers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Subscriber" }],
      // Vale para "all" e "categories": conteúdo que os membros já dominam
      excludeMembers: { type: Boolean, default: false },
    },

    // Post do blog que originou o conteúdo (opcional). Se estiver publicado
    // na hora do envio, o email ganha o botão "Ler no blog".
    post: { type: mongoose.Schema.Types.ObjectId, ref: "BlogPost", default: null },

    status: {
      type: String,
      enum: ["draft", "sending", "sent"],
      default: "draft",
    },

    // Snapshot dos destinatários no momento do envio. Permite retomar o envio
    // em lotes (a API roda serverless e não pode enviar em background).
    recipients: { type: [RecipientSchema], default: [] },

    startedAt: Date,
    sentAt: Date,
  },
  { timestamps: true }
);

CampaignSchema.methods.stats = function () {
  const stats = { total: this.recipients.length, pending: 0, sent: 0, failed: 0 };
  for (const r of this.recipients) stats[r.status]++;
  return stats;
};

CampaignSchema.statics.AUDIENCE_TYPES = AUDIENCE_TYPES;

module.exports =
  mongoose.models.Campaign || mongoose.model("Campaign", CampaignSchema);
