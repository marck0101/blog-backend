/**
 * Importa um post avulso (content/<pasta>/post.json + HTML) como RASCUNHO, com
 * data no calendário editorial (plannedAt do post.json).
 *
 * Uso:
 *   node scripts/import-draft.js content/pagespeed-clarity-parte-2                  # simulação no banco DEV
 *   node scripts/import-draft.js content/pagespeed-clarity-parte-2 --apply          # grava no banco DEV
 *   node scripts/import-draft.js content/pagespeed-clarity-parte-2 --apply --prod
 *   ... --update   atualiza o rascunho que já existe com o mesmo slug
 *
 * Regras de segurança (as mesmas do import-season.js):
 * - Sempre grava status "draft" (published false) — nunca publica nem dispara e-mail.
 * - Post existente que não é rascunho (publicado/agendado) nunca é alterado.
 * - Sem --apply, só mostra o que faria.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const BlogPost = require("../app/models/blogpost.model");

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
const PROD = args.includes("--prod");
const UPDATE = args.includes("--update");

if (!dir) {
  console.error("Informe a pasta do post. Ex.: node scripts/import-draft.js content/pagespeed-clarity-parte-2");
  process.exit(1);
}

const MONGO_URI = PROD ? process.env.MONGO_URI_PROD : process.env.MONGO_URI_DEV;

function loadPost(postDir) {
  const meta = JSON.parse(fs.readFileSync(path.join(postDir, "post.json"), "utf8"));
  if ((meta.excerpt || "").length > 160) throw new Error("excerpt com mais de 160 caracteres");
  const plannedAt = meta.plannedAt ? new Date(meta.plannedAt) : null;
  if (plannedAt && Number.isNaN(plannedAt.getTime())) throw new Error(`plannedAt inválido: ${meta.plannedAt}`);
  return {
    title: meta.title,
    slug: meta.slug,
    excerpt: meta.excerpt,
    category: meta.category,
    faq: meta.faq || [],
    content: fs.readFileSync(path.join(postDir, meta.file || "content.html"), "utf8"),
    plannedAt,
  };
}

async function main() {
  const data = loadPost(path.resolve(dir));
  const when = data.plannedAt ? data.plannedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "sem data";
  console.log(`[rascunho] ${data.slug} · calendário: ${when} · banco ${PROD ? "PROD" : "DEV"} · ${APPLY ? "GRAVANDO" : "simulação"}`);

  await mongoose.connect(MONGO_URI);

  const existing = await BlogPost.findOne({ slug: data.slug }).select("_id status");
  if (existing && existing.status !== "draft") {
    console.log(`  pular   já existe com status ${existing.status}`);
  } else if (existing && !UPDATE) {
    console.log("  pular   rascunho já existe; use --update");
  } else if (!APPLY) {
    console.log(`  ${existing ? "atualiz." : "criar  "} ${data.title}`);
  } else {
    const draft = { ...data, status: "draft", published: false };
    if (existing) {
      await BlogPost.updateOne({ _id: existing._id }, { $set: draft }, { runValidators: true });
      console.log(`  atualizado ${data.slug}`);
    } else {
      const post = await BlogPost.create(draft);
      console.log(`  criado     ${data.slug} (${post._id})`);
    }
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("[rascunho] erro:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
