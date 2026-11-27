const mongoose = require("mongoose");

// Assinaturas já usadas: o mesmo pedido assinado não vale duas vezes (replay).
// Some sozinha depois da janela de tempo aceita.
const CockpitNonceSchema = new mongoose.Schema({
  sig: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

module.exports = mongoose.models.CockpitNonce || mongoose.model("CockpitNonce", CockpitNonceSchema);
