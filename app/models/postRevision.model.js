const mongoose = require("mongoose");

// Histórico de um post, no estilo git: cada gravação que muda o que o leitor vê
// (texto, imagens, FAQ, SEO…) vira uma versão nova (v1, v2, v3…). Versões nunca
// são editadas nem apagadas, só o post inteiro na exclusão definitiva.
// Restaurar uma versão antiga cria uma versão nova com aquele conteúdo.
// Só o painel (admin) lê e restaura.
const PostRevisionSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: "BlogPost", required: true },
    version: { type: Number, required: true },

    // Estado do post depois da gravação (campos de REVISION_FIELDS no service)
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    // Resumo para a lista, sem carregar o conteúdo inteiro de cada versão
    summary: {
      title: { type: String, default: "" },
      images: { type: Number, default: 0 },
      chars: { type: Number, default: 0 },
    },
    // Campos que mudaram em relação à versão anterior
    changes: { type: [String], default: [] },

    // baseline = estado encontrado antes da primeira edição com histórico
    reason: {
      type: String,
      enum: ["baseline", "create", "edit", "restore", "image-removed"],
      default: "edit",
    },
    restoredFrom: { type: Number, default: null },
    author: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      name: { type: String, default: "" },
    },
    // Detecta gravação sem mudança (não gera versão)
    hash: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

PostRevisionSchema.index({ post: 1, version: -1 }, { unique: true });

module.exports =
  mongoose.models.PostRevision ||
  mongoose.model("PostRevision", PostRevisionSchema);
