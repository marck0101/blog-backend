const mongoose = require("mongoose");

// Público nomeado (ex.: "Clientes 2025", "Evento SEBRAE"): grupo de assinantes
// montado no painel ou por importação de lista. Um assinante pode estar em
// vários; a ligação fica em Subscriber.lists.
const AudienceListSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "O nome do público é obrigatório"], trim: true, maxlength: 80 },
    description: { type: String, trim: true, default: "", maxlength: 300 },
    // Na lixeira: some do painel e dos envios, mas as pessoas continuam ligadas
    // a ele (Subscriber.lists), então restaurar devolve o público completo
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

AudienceListSchema.index({ name: 1 }, { unique: true, collation: { locale: "pt", strength: 2 } });

module.exports = mongoose.models.AudienceList || mongoose.model("AudienceList", AudienceListSchema);
