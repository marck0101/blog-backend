const mongoose = require("mongoose");

// Conta do LinkedIn conectada ao blog (perfil pessoal do autor). Documento
// único: conectar de novo substitui o anterior. O token vale 60 dias e o
// produto "Share on LinkedIn" não dá refresh token, então é preciso
// reconectar pelo painel antes de expirar.
const LinkedInAccountSchema = new mongoose.Schema(
  {
    personUrn: { type: String, required: true }, // urn:li:person:{sub}
    name: String,
    picture: String,
    accessToken: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    scope: String,
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.LinkedInAccount ||
  mongoose.model("LinkedInAccount", LinkedInAccountSchema);
