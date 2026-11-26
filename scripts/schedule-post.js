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
 * - Recusa link interno para post que ainda não estará no ar nessa data.
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

/**
 * Links internos (/blog/<slug>) que dariam 404 no dia da publicação:
 * post inexistente, rascunho ou agendado para depois deste.
 * `targets` = { slug: { status, plannedAt } }.
 */
function linkProblems(content, targets, plannedAt) {
  const problems = [];
  for (const [, slug] of (content || "").matchAll(/href="\/blog\/([\w-]+)"/g)) {
    const t = targets[slug];
    if (!t) problems.push(`${slug} (não existe)`);
    else if (t.status === "published") continue;
    else if (t.status !== "planned" || !t.plannedAt || t.plannedAt > plannedAt) problems.push(`${slug} (${t.status}${t.plannedAt ? " " + t.plannedAt.toISOString().slice(0, 10) : ""})`);
  }
  return [...new Set(problems)];
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
    const linked = [...(post.content || "").matchAll(/href="\/blog\/([\w-]+)"/g)].map((m) => m[1]);
    const docs = linked.length ? await BlogPost.find({ slug: { $in: linked }, deletedAt: null }).select("slug status plannedAt") : [];
    const problems = linkProblems(post.content, Object.fromEntries(docs.map((d) => [d.slug, d])), plannedAt);
    if (problems.length) throw new Error(`Links que dariam 404 nessa data: ${problems.join(", ")}`);
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

module.exports = { main, plannedDate, linkProblems, MARKERS };
