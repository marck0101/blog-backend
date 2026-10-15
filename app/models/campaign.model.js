const mongoose = require("mongoose");

const AUDIENCE_TYPES = ["members", "all", "categories", "selected", "lists"];

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

    // Engajamento (só em envios com rastreio): primeira vez e total
    openedAt: Date,
    opens: { type: Number, default: 0 },
    clickedAt: Date,
    clicks: { type: Number, default: 0 },
    unsubscribedAt: Date,
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
      // Públicos nomeados (type "lists")
      lists: [{ type: mongoose.Schema.Types.ObjectId, ref: "AudienceList" }],
      // Vale para "all" e "categories": conteúdo que os membros já dominam
      excludeMembers: { type: Boolean, default: false },
    },

    // Post do blog que originou o conteúdo (opcional). Se estiver publicado
    // na hora do envio, o email ganha o botão "Ler no blog".
    post: { type: mongoose.Schema.Types.ObjectId, ref: "BlogPost", default: null },

    // "post-notification" = aviso automático de post novo
    kind: {
      type: String,
      enum: ["custom", "post-notification"],
      default: "custom",
    },

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

    // Pixel de abertura e links rastreados. Envios anteriores ao rastreio
    // ficam sem taxas (não dá para saber quem abriu).
    tracking: { type: Boolean, default: false },
  },
  { timestamps: true }
);

CampaignSchema.index({ kind: 1, post: 1 });

// Busca "este email recebeu quais envios?"
CampaignSchema.index({ "recipients.email": 1 });

CampaignSchema.methods.stats = function () {
  const stats = {
    total: this.recipients.length,
    pending: 0,
    sent: 0,
    failed: 0,
    opened: 0,
    clicked: 0,
    unsubscribed: 0,
  };
  for (const r of this.recipients) {
    stats[r.status]++;
    if (r.openedAt) stats.opened++;
    if (r.clickedAt) stats.clicked++;
    if (r.unsubscribedAt) stats.unsubscribed++;
  }
  // Taxas sobre os entregues; null quando não há rastreio
  const rate = (n) => (this.tracking && stats.sent > 0 ? n / stats.sent : null);
  stats.openRate = rate(stats.opened);
  stats.clickRate = rate(stats.clicked);
  stats.unsubscribeRate = rate(stats.unsubscribed);
  // CTOR: de quem abriu, quantos clicaram
  stats.clickToOpenRate = this.tracking && stats.opened > 0 ? stats.clicked / stats.opened : null;
  return stats;
};

CampaignSchema.statics.AUDIENCE_TYPES = AUDIENCE_TYPES;

module.exports =
  mongoose.models.Campaign || mongoose.model("Campaign", CampaignSchema);
