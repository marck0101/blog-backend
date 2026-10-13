/**
 * Importa os posts de uma season (content/<season>/season.json + HTMLs) como RASCUNHO.
 *
 * Uso:
 *   node scripts/import-season.js content/midia-paga-na-pratica            # simulação no banco DEV
 *   node scripts/import-season.js content/midia-paga-na-pratica --apply    # grava no banco DEV
 *   node scripts/import-season.js content/midia-paga-na-pratica --apply --prod
 *   ... --update   atualiza rascunhos que já existem com o mesmo slug
 *
 * Regras de segurança:
 * - Sempre grava status "draft" (published false, sem plannedAt) — nunca publica nem dispara e-mail.
 * - Post existente que não é rascunho (publicado/planejado) nunca é alterado.
 * - Sem --apply, só mostra o que faria.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const BlogPost = require("../app/models/blogpost.model");

// Trechos que não podem aparecer no conteúdo público (prefixo interno de nomenclatura etc.)
const FORBIDDEN = [/\bGH_/];

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
const PROD = args.includes("--prod");
const UPDATE = args.includes("--update");

if (!dir) {
  console.error("Informe a pasta da season. Ex.: node scripts/import-season.js content/midia-paga-na-pratica");
  process.exit(1);
}

const MONGO_URI = PROD ? process.env.MONGO_URI_PROD : process.env.MONGO_URI_DEV;

function loadSeason(seasonDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(seasonDir, "season.json"), "utf8"));
  return manifest.posts.map((p) => {
    const content = fs.readFileSync(path.join(seasonDir, p.file), "utf8");
    for (const re of FORBIDDEN) {
      if (re.test(content) || re.test(p.title)) {
        throw new Error(`${p.file}: contém trecho proibido (${re})`);
      }
    }
    if ((p.excerpt || "").length > 160) throw new Error(`${p.file}: excerpt com mais de 160 caracteres`);
    return {
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt,
      category: p.category,
      content,
      season: manifest.season,
      seasonOrder: p.seasonOrder,
    };
  });
}

async function main() {
  const posts = loadSeason(path.resolve(dir));
  console.log(`[season] ${posts.length} posts · banco ${PROD ? "PROD" : "DEV"} · ${APPLY ? "GRAVANDO" : "simulação"}${UPDATE ? " · --update" : ""}`);

  await mongoose.connect(MONGO_URI);

  for (const data of posts) {
    const existing = await BlogPost.findOne({ slug: data.slug }).select("_id status deletedAt");

    if (existing && existing.status !== "draft") {
      console.log(`  pular   ${data.slug} (existe com status ${existing.status})`);
      continue;
    }
    if (existing && !UPDATE) {
      console.log(`  pular   ${data.slug} (rascunho já existe; use --update)`);
      continue;
    }

    const draft = { ...data, status: "draft", published: false, plannedAt: null };

    if (!APPLY) {
      console.log(`  ${existing ? "atualiz." : "criar  "} ${data.slug}`);
      continue;
    }

    if (existing) {
      await BlogPost.updateOne({ _id: existing._id }, { $set: draft }, { runValidators: true });
      console.log(`  atualizado ${data.slug}`);
    } else {
      await BlogPost.create(draft);
      console.log(`  criado     ${data.slug}`);
    }
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("[season] erro:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
