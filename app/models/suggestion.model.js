const mongoose = require("mongoose");
const { SLUGS: CATEGORY_SLUGS } = require("../config/categories");

// Caixinha de sugestões (seção 19 do SISTEMA.md). O leitor sugere um tema ou
// pede para participar de um conteúdo. Tudo é privado: o blog só mostra a
// sugestão que o admin marcou como atendida, ligou a um post publicado e
// escolheu mostrar, com o texto público escrito pelo admin (nunca o original).
const KINDS = ["topic", "participate", "other"];
// new = chegou | planned = vai virar conteúdo | done = virou o post `post` | archived = não vai virar
const STATUSES = ["new", "planned", "done", "archived"];

const SuggestionSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: KINDS, default: "topic" },
    category: { type: String, enum: CATEGORY_SLUGS, required: true },
    message: { type: String, required: true, trim: true, maxlength: 1500 },

    // Quem sugeriu: só o painel vê o email
    name: { type: String, trim: true, default: "" },
    email: { type: String, required: true, trim: true, lowercase: true },
    // A pessoa autorizou mostrar o primeiro nome se a sugestão aparecer no blog
    allowName: { type: Boolean, default: false },
    // Pediu para assinar junto (marcou a caixa do formulário)
    subscribed: { type: Boolean, default: false },
    subscriber: { type: mongoose.Schema.Types.ObjectId, ref: "Subscriber", default: null },
    // Página de onde veio (ex.: o post em que clicou "sugira um tema")
    sourcePath: { type: String, default: "" },

    status: { type: String, enum: STATUSES, default: "new" },
    post: { type: mongoose.Schema.Types.ObjectId, ref: "BlogPost", default: null },
    doneAt: { type: Date, default: null },
    // Vitrine pública (/sugestoes): só com status done + post publicado + texto público
    isPublic: { type: Boolean, default: false },
    publicText: { type: String, trim: true, default: "", maxlength: 300 },
    // Anotação interna do admin
    notes: { type: String, trim: true, default: "", maxlength: 2000 },
    // Email "sua sugestão virou post" (uma vez só)
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SuggestionSchema.index({ status: 1, createdAt: -1 });
SuggestionSchema.index({ isPublic: 1, doneAt: -1 });

module.exports = mongoose.models.Suggestion || mongoose.model("Suggestion", SuggestionSchema);
module.exports.KINDS = KINDS;
module.exports.STATUSES = STATUSES;
