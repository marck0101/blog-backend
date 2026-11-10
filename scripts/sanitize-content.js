/**
 * Limpa o HTML já gravado de posts e envios com a mesma regra do painel
 * (app/utils/sanitizeHtml.js, SEC-01). Posts e envios novos já são limpos ao salvar.
 *
 * Uso:
 *   node scripts/sanitize-content.js                  # relatório no banco DEV
 *   node scripts/sanitize-content.js --prod           # relatório em produção
 *   node scripts/sanitize-content.js --prod --apply   # grava onde há risco
 *   ... --all   grava também diferenças só de formatação (<br> → <br />)
 *
 * - Post alterado ganha uma versão no histórico ("limpeza de HTML"), então dá
 *   para ver e restaurar o que estava antes.
 * - Não mexe no updatedAt (o sitemap não acusa mudança de conteúdo).
 */
require("dotenv").config();
const mongoose = require("mongoose");
const BlogPost = require("../app/models/blogpost.model");
const Campaign = require("../app/models/campaign.model");
const { sanitizeHtml, looksDangerous } = require("../app/utils/sanitizeHtml");
const { safeRecordRevision, ensureBaseline } = require("../app/services/postRevision.service");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const PROD = args.includes("--prod");
const ALL = args.includes("--all");
const MONGO_URI = PROD ? process.env.MONGO_URI_PROD : process.env.MONGO_URI_DEV;

const AUTHOR = { id: null, name: "limpeza de HTML (SEC-01)" };

/** O que fazer com um HTML: null (nada), "risco" ou "formato" */
function classify(html) {
  if (!html) return null;
  const clean = sanitizeHtml(html);
  if (clean === html) return null;
  return { clean, kind: looksDangerous(html) ? "risco" : "formato" };
}

const shouldWrite = (kind) => APPLY && (kind === "risco" || ALL);

async function sweepPosts() {
  const posts = await BlogPost.find({ content: { $nin: [null, ""] } }).select("title content deletedAt");
  const count = { risco: 0, formato: 0, gravados: 0 };
  for (const post of posts) {
    const result = classify(post.content);
    if (!result) continue;
    count[result.kind]++;
    if (result.kind === "risco") console.log(`  [risco] post "${post.title}"${post.deletedAt ? " (lixeira)" : ""}`);
    if (!shouldWrite(result.kind)) continue;

    await ensureBaseline(post._id);
    await BlogPost.updateOne({ _id: post._id }, { $set: { content: result.clean } }, { timestamps: false });
    await safeRecordRevision(await BlogPost.findById(post._id), { reason: "edit", author: AUTHOR });
    count.gravados++;
  }
  return { total: posts.length, ...count };
}

async function sweepCampaigns() {
  const campaigns = await Campaign.find({ content: { $nin: [null, ""] } }).select("subject content status");
  const count = { risco: 0, formato: 0, gravados: 0 };
  for (const campaign of campaigns) {
    const result = classify(campaign.content);
    if (!result) continue;
    count[result.kind]++;
    if (result.kind === "risco") console.log(`  [risco] envio "${campaign.subject}" (${campaign.status})`);
    if (!shouldWrite(result.kind)) continue;
    await Campaign.updateOne({ _id: campaign._id }, { $set: { content: result.clean } }, { timestamps: false });
    count.gravados++;
  }
  return { total: campaigns.length, ...count };
}

async function main() {
  if (!MONGO_URI) throw new Error(`MONGO_URI_${PROD ? "PROD" : "DEV"} não definida`);
  console.log(`Banco ${PROD ? "PRODUÇÃO" : "DEV"} · ${APPLY ? (ALL ? "GRAVANDO tudo" : "GRAVANDO só o que tem risco") : "relatório (nada é gravado)"}\n`);
  await mongoose.connect(MONGO_URI);

  const posts = await sweepPosts();
  const campaigns = await sweepCampaigns();

  console.log(`\nPosts:  ${posts.total} com conteúdo · ${posts.risco} com risco · ${posts.formato} só formatação · ${posts.gravados} gravados`);
  console.log(`Envios: ${campaigns.total} com conteúdo · ${campaigns.risco} com risco · ${campaigns.formato} só formatação · ${campaigns.gravados} gravados`);
  if (!APPLY && posts.risco + campaigns.risco > 0) console.log("\nRode com --apply para limpar os que têm risco.");
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { classify };
