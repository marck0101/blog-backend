/**
 * Histórico de versões: posts criados antes do versionamento não têm nenhuma
 * versão. O primeiro save no painel já guarda o estado anterior como v1, mas
 * uma edição feita fora do painel (script, banco direto) não passaria por lá.
 * Este script congela agora o estado atual de cada post sem histórico como v1.
 *
 *   node scripts/backfill-revisions.js            → mostra o que seria criado (dry run)
 *   node scripts/backfill-revisions.js --apply    → grava
 *
 * Usa MONGO_URI_PROD com NODE_ENV=production, senão MONGO_URI_DEV.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const BlogPost = require("../app/models/blogpost.model");
const PostRevision = require("../app/models/postRevision.model");
const { recordRevision } = require("../app/services/postRevision.service");

const MONGO_URI =
  process.env.NODE_ENV === "production"
    ? process.env.MONGO_URI_PROD
    : process.env.MONGO_URI_DEV;

const apply = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(MONGO_URI);
  console.log(`Banco: ${process.env.NODE_ENV === "production" ? "PRODUÇÃO" : "local"} | ${apply ? "GRAVANDO" : "dry run"}`);

  const withHistory = new Set((await PostRevision.distinct("post")).map(String));
  const posts = await BlogPost.find({}).lean();
  const missing = posts.filter((p) => !withHistory.has(String(p._id)));

  for (const p of missing) {
    const images = ((p.content || "").match(/<img\b/gi) || []).length;
    console.log(`${p.slug}: v1 (${images} imagem(ns) no texto)`);
    if (apply) await recordRevision(p, { reason: "baseline" });
  }

  console.log(`\n${missing.length} post(s) sem histórico de ${posts.length}${apply ? " — v1 gravada" : ""}`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
