/**
 * Tempo de leitura nos cards: o campo readingMinutes passou a ser gravado ao
 * salvar o post. Este script calcula o valor dos posts que já existiam.
 * Não mexe no updatedAt (o sitemap e o schema usam essa data).
 *
 *   node scripts/backfill-reading-minutes.js            → mostra o que mudaria (dry run)
 *   node scripts/backfill-reading-minutes.js --apply    → grava
 *
 * Usa MONGO_URI_PROD com NODE_ENV=production, senão MONGO_URI_DEV.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const BlogPost = require("../app/models/blogpost.model");
const { readingMinutes } = require("../app/utils/readingTime");

const MONGO_URI =
  process.env.NODE_ENV === "production"
    ? process.env.MONGO_URI_PROD
    : process.env.MONGO_URI_DEV;

const apply = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(MONGO_URI);
  console.log(`Banco: ${process.env.NODE_ENV === "production" ? "PRODUÇÃO" : "local"} | ${apply ? "GRAVANDO" : "dry run"}`);

  const posts = await BlogPost.find({}).select("_id slug content readingMinutes").lean();
  let changed = 0;

  for (const p of posts) {
    const minutes = readingMinutes(p.content);
    if (p.readingMinutes === minutes) continue;
    changed++;
    console.log(`${p.slug}: ${p.readingMinutes ?? "—"} → ${minutes} min`);
    if (apply) {
      await BlogPost.updateOne({ _id: p._id }, { $set: { readingMinutes: minutes } }, { timestamps: false });
    }
  }

  console.log(`\n${changed} de ${posts.length} post(s) ${apply ? "atualizados" : "mudariam"}`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
