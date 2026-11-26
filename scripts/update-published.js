/**
 * Aplica as correções das auditorias (Sprint 2 e 3) em posts JÁ PUBLICADOS:
 * content/<pasta>/content.html + post.json com "status": "published".
 *
 * Uso:
 *   node scripts/update-published.js                 # simulação de todas as pastas, banco DEV
 *   node scripts/update-published.js content/<pasta> # só uma pasta
 *   node scripts/update-published.js --apply         # grava no banco DEV
 *   node scripts/update-published.js --apply --prod  # grava no banco de PRODUÇÃO
 *
 * Regras de segurança:
 * - Só mexe em post publicado e fora da lixeira; rascunho e agendado ficam com o import-draft/import-season.
 * - Só altera conteúdo (passa pelo sanitizeHtml, como o painel) e os campos de SEO do
 *   post.json: tema, pilar, tags, resposta direta e FAQ (scripts/post-meta.js).
 *   Título, slug, resumo, datas e status nunca mudam.
 * - Recusa conteúdo com "[A COMPLETAR" ou nota de rascunho.
 * - Guarda a versão anterior no histórico de revisões, então dá para restaurar pelo painel.
 * - Sem --apply, só mostra o que mudaria.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const BlogPost = require("../app/models/blogpost.model");
const revisions = require("../app/services/postRevision.service");
const { seoFields } = require("./post-meta");
const { sanitizeHtml } = require("../app/utils/sanitizeHtml");
const { normalizeTags } = require("../app/utils/tags");

const CONTENT_DIR = path.join(__dirname, "..", "content");
const FORBIDDEN = [/\[A COMPLETAR/i, /\[RASCUNHO/i, /\[INTERNO/i];
const AUTHOR = { id: null, name: "script update-published" };

const links = (html) => (String(html || "").match(/<a\s/g) || []).length;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Lê uma pasta e devolve { slug, set } ou null se não for post publicado */
function loadPublished(dir) {
  const metaPath = path.join(dir, "post.json");
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  if (meta.status !== "published") return null;
  if (!meta.slug) throw new Error(`${dir}: post.json sem slug`);

  const set = seoFields(meta, path.basename(dir) + "/post.json");
  // Mesma normalização do modelo, para a comparação não acusar mudança falsa
  if (set.tags) set.tags = normalizeTags(set.tags);
  const htmlPath = path.join(dir, meta.file || "content.html");
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, "utf8");
    for (const re of FORBIDDEN) {
      if (re.test(html)) throw new Error(`${path.basename(dir)}: conteúdo com trecho proibido (${re})`);
    }
    set.content = sanitizeHtml(html);
  }
  return { slug: meta.slug, set };
}

/** Campos que realmente mudam, com um resumo legível de cada um */
function diff(post, set) {
  const changes = {};
  const lines = [];
  for (const [key, value] of Object.entries(set)) {
    if (same(post[key], value)) continue;
    changes[key] = value;
    if (key === "content") {
      lines.push(`content: ${String(post.content || "").length} → ${value.length} caracteres, links ${links(post.content)} → ${links(value)}`);
    } else if (key === "faq") {
      lines.push(`faq: ${(post.faq || []).length} → ${value.length} perguntas`);
    } else {
      lines.push(`${key}: ${JSON.stringify(post[key] ?? null)} → ${JSON.stringify(value)}`);
    }
  }
  return { changes, lines };
}

function targetDirs(args) {
  const given = args.filter((a) => !a.startsWith("--"));
  if (given.length) return given.map((d) => path.resolve(d));
  return fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => path.join(CONTENT_DIR, d.name));
}

async function main(args = process.argv.slice(2)) {
  const APPLY = args.includes("--apply");
  const PROD = args.includes("--prod");
  const uri = PROD ? process.env.MONGO_URI_PROD : process.env.MONGO_URI_DEV;
  if (!uri) throw new Error(`Defina ${PROD ? "MONGO_URI_PROD" : "MONGO_URI_DEV"} no .env`);

  // Lê e valida tudo antes de conectar: um arquivo com problema não deixa o lote pela metade
  const items = targetDirs(args).map(loadPublished).filter(Boolean);
  console.log(`[publicados] ${items.length} pasta(s) · banco ${PROD ? "PROD" : "DEV"} · ${APPLY ? "GRAVANDO" : "simulação"}`);

  await mongoose.connect(uri);
  const summary = { updated: 0, unchanged: 0, skipped: 0 };
  try {
    for (const { slug, set } of items) {
      const post = await BlogPost.findOne({ slug, deletedAt: null }).lean();
      if (!post || post.status !== "published") {
        console.log(`  pular      ${slug} (${post ? `status ${post.status}` : "não existe neste banco"})`);
        summary.skipped++;
        continue;
      }
      const { changes, lines } = diff(post, set);
      if (!lines.length) {
        console.log(`  igual      ${slug}`);
        summary.unchanged++;
        continue;
      }
      console.log(`  ${APPLY ? "atualizar" : "mudaria  "}  ${slug}`);
      for (const line of lines) console.log(`               ${line}`);
      if (APPLY) {
        await revisions.ensureBaseline(post._id);
        const updated = await BlogPost.findByIdAndUpdate(post._id, { $set: changes }, { new: true, runValidators: true });
        await revisions.safeRecordRevision(updated, { author: AUTHOR });
      }
      summary.updated++;
    }
  } finally {
    await mongoose.disconnect();
  }
  console.log(`[fim] ${summary.updated} ${APPLY ? "atualizado(s)" : "mudaria(m)"} · ${summary.unchanged} igual(is) · ${summary.skipped} pulado(s)`);
  return summary;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { loadPublished, diff, main };
