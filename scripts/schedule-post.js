/**
 * Agenda um rascunho para publicar sozinho na rotina diária (status "planned").
 *
 * Uso:
 *   node scripts/schedule-post.js <slug> 2026-11-30                 # simulação no banco DEV
 *   node scripts/schedule-post.js <slug> 2026-11-30 --apply --prod  # grava no banco de PRODUÇÃO
 *   ... --season <slug-da-season> --order <n>                      # opcional: liga à season
 *
 * Regras de segurança:
 * - Só agenda post que está como rascunho (nunca mexe em publicado).
 * - Recusa texto com aviso interno ([A COMPLETAR, [RASCUNHO, [INTERNO).
 * - A data vira 08:50 de Brasília: a rotina diária roda às 9h (12:00 UTC) e publica o que já venceu.
 */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const BlogPost = require("../app/models/blogpost.model");
const { seasonExists } = require("../app/services/season.service");

const MARKERS = /\[(A COMPLETAR|RASCUNHO|INTERNO)/;

function plannedDate(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) throw new Error("Data no formato AAAA-MM-DD");
  return new Date(`${day}T08:50:00-03:00`);
}

function option(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(args = process.argv.slice(2)) {
  const [slug, day] = args.filter((a, i) => !a.startsWith("--") && !["--season", "--order"].includes(args[i - 1]));
  const APPLY = args.includes("--apply");
  const PROD = args.includes("--prod");
  const season = option(args, "--season");
  const order = option(args, "--order");
  if (!slug) throw new Error("Informe o slug do post");
  const plannedAt = plannedDate(day);
  if (plannedAt <= new Date()) throw new Error("A data precisa ser futura");

  const uri = PROD ? process.env.MONGO_URI_PROD : process.env.MONGO_URI_DEV;
  if (!uri) throw new Error(`Defina ${PROD ? "MONGO_URI_PROD" : "MONGO_URI_DEV"} no .env`);
  await mongoose.connect(uri);
  try {
    const post = await BlogPost.findOne({ slug, deletedAt: null }).select("status content title plannedAt");
    if (!post) throw new Error(`Post não existe neste banco: ${slug}`);
    if (post.status === "published") throw new Error(`Já publicado: ${slug}`);
    const marker = (post.content || "").match(MARKERS);
    if (marker) throw new Error(`Texto ainda tem "${marker[0]}": revise antes de agendar`);
    if (season && !(await seasonExists(season))) throw new Error(`Season não existe: ${season}`);

    const set = { status: "planned", published: false, plannedAt };
    if (season) set.season = season;
    if (order) set.seasonOrder = Number(order);
    const when = plannedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    console.log(`[${PROD ? "PROD" : "DEV"}] ${APPLY ? "agendado" : "agendaria"}: ${post.title} → ${when}${season ? ` · ${season} #${order || "-"}` : ""}`);
    if (APPLY) await BlogPost.updateOne({ _id: post._id }, { $set: set }, { runValidators: true });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { main, plannedDate, MARKERS };
