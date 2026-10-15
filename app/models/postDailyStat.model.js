const mongoose = require("mongoose");

// Números de um post em um dia (fuso de Brasília): leituras, favoritos e
// compartilhamentos por canal. Base dos destaques da semana e das métricas de
// engajamento. Um documento por post por dia, criado no primeiro evento.
const counters = () => ({ type: Map, of: Number, default: {} });

const PostDailyStatSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: "BlogPost", required: true },
    day: { type: String, required: true }, // "YYYY-MM-DD"
    views: { type: Number, default: 0 },
    favorites: { type: Number, default: 0 },
    unfavorites: { type: Number, default: 0 },
    // canal → quantidade (whatsapp, linkedin, x, facebook, telegram, email, copy, native)
    shares: counters(),
    // Visitas que chegaram por um link compartilhado (utm_medium=share), por canal
    shareVisits: counters(),
  },
  { versionKey: false }
);

PostDailyStatSchema.index({ post: 1, day: 1 }, { unique: true });
PostDailyStatSchema.index({ day: 1 });

module.exports =
  mongoose.models.PostDailyStat || mongoose.model("PostDailyStat", PostDailyStatSchema);
