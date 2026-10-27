const mongoose = require("mongoose");

// Season: série de posts que se complementam (ex.: do topo ao fundo do funil).
// O post guarda o slug em `season`; a ordem dos episódios fica em `seasonOrder`.
const SeasonSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "O título da season é obrigatório"],
      trim: true,
      minlength: [3, "O título deve ter pelo menos 3 caracteres"],
      maxlength: [100, "O título deve ter no máximo 100 caracteres"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug inválido (use letras minúsculas, números e hífen)"],
    },
    // Aparece na página da season para o leitor: o que ele vai aprender na sequência
    description: { type: String, trim: true, default: "", maxlength: 600 },
    // Ordem na página /seasons (menor primeiro)
    order: { type: Number, default: 0 },
    // Perguntas frequentes da season: aparecem na página dela e viram FAQPage (schema.org)
    faq: [
      {
        _id: false,
        question: { type: String, trim: true, required: [true, "Pergunta do FAQ vazia"], maxlength: 200 },
        answer: { type: String, trim: true, required: [true, "Resposta do FAQ vazia"], maxlength: 1500 },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.models.Season || mongoose.model("Season", SeasonSchema);
