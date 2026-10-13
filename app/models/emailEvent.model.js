const mongoose = require("mongoose");

// Abertura, clique ou cancelamento vindo de um envio. Cada ocorrência vira um
// evento (dá série no tempo e cliques por link); o primeiro de cada tipo
// também fica resumido no destinatário do envio.
const EmailEventSchema = new mongoose.Schema(
  {
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    subscriber: { type: mongoose.Schema.Types.ObjectId, ref: "Subscriber", required: true },
    type: { type: String, enum: ["open", "click", "unsubscribe"], required: true },
    url: String, // só cliques
    // Robôs, antivírus e pré-carregamento: ficam registrados, mas fora das taxas
    automated: { type: Boolean, default: false },
    userAgent: String,
    at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

EmailEventSchema.index({ campaign: 1, type: 1 });
EmailEventSchema.index({ at: 1 });

module.exports =
  mongoose.models.EmailEvent || mongoose.model("EmailEvent", EmailEventSchema);
