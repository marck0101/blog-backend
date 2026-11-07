const mongoose = require("mongoose");

// Comentário de leitor (login com Google) ou resposta do autor do blog.
// Leitor: entra como pending e só aparece depois de aprovado no painel.
// Recusado: some para os outros; o autor do comentário continua vendo, com o motivo.
// Um nível de resposta: parent aponta sempre para um comentário principal.
const CommentSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: "BlogPost", required: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "Comment", default: null },

    author: {
      sub: { type: String, default: "" }, // id da conta Google (vazio na resposta do autor)
      name: { type: String, required: true },
      email: { type: String, default: "" }, // só o painel vê
      picture: { type: String, default: "" },
    },
    // Resposta do autor do blog, escrita pelo painel
    isAuthor: { type: Boolean, default: false },

    body: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    approvedAt: { type: Date, default: null },
    // Recusa: motivo opcional (o leitor vê no post e no email) e quando ele foi avisado
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "", maxlength: 500 },
    readerNotifiedAt: { type: Date, default: null },
    // O leitor apagou o próprio comentário, mas outras pessoas já tinham
    // respondido: fica só o lugar ("removido pelo autor"), sem texto nem dados
    // dele, para não sumir com as respostas dos outros.
    removedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

CommentSchema.index({ post: 1, status: 1, createdAt: 1 });
CommentSchema.index({ status: 1, createdAt: -1 });
CommentSchema.index({ "author.sub": 1, createdAt: -1 });

module.exports = mongoose.models.Comment || mongoose.model("Comment", CommentSchema);
