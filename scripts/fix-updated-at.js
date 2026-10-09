/**
 * Até 2026-10-09 cada visualização de post atualizava o updatedAt, então o
 * lastmod do sitemap e o dateModified dos dados estruturados diziam que todos
 * os posts tinham sido alterados no dia da última visita. A data real da
 * última edição se perdeu; este script volta o updatedAt dos posts publicados
 * para a data de publicação (o valor mais honesto disponível).
 *
 *   node scripts/fix-updated-at.js            → mostra o que mudaria (dry run)
 *   node scripts/fix-updated-at.js --apply    → grava
 *
 * Usa MONGO_URI_PROD com NODE_ENV=production, senão MONGO_URI_DEV.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const BlogPost = require("../app/models/blogpost.model");

const MONGO_URI =
  process.env.NODE_ENV === "production"
    ? process.env.MONGO_URI_PROD
    : process.env.MONGO_URI_DEV;

const apply = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(MONGO_URI);
  console.log(`Banco: ${process.env.NODE_ENV === "production" ? "PRODUÇÃO" : "local"} | ${apply ? "GRAVANDO" : "dry run"}`);

  const posts = await BlogPost.find(
    { published: true, publishedAt: { $ne: null } },
    "slug publishedAt updatedAt"
  ).lean();

  const toFix = posts.filter((p) => p.updatedAt > p.publishedAt);
  for (const p of toFix) {
    console.log(`${p.slug}: ${p.updatedAt.toISOString()} → ${p.publishedAt.toISOString()}`);
  }

  if (apply && toFix.length) {
    const result = await BlogPost.collection.bulkWrite(
      toFix.map((p) => ({
        updateOne: { filter: { _id: p._id }, update: { $set: { updatedAt: p.publishedAt } } },
      }))
    );
    console.log(`Atualizados: ${result.modifiedCount}`);
  } else {
    console.log(`${toFix.length} de ${posts.length} posts publicados seriam ajustados`);
  }

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
