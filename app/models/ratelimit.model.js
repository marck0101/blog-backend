const mongoose = require("mongoose");

// Contador de tentativas (login, esqueci a senha) por chave "acao:ip".
// Fica no banco porque na Vercel cada requisição pode cair numa instância diferente.
const RateLimitSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  // O MongoDB apaga o documento sozinho quando a janela expira
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

module.exports = mongoose.models.RateLimit || mongoose.model("RateLimit", RateLimitSchema);
