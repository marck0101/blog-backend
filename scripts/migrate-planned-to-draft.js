/**
 * Migração do modelo de status (out/2026):
 * antes, "planned" significava só "tem data no calendário"; agora significa
 * "agendado: pronto e publica sozinho na data". Os posts "planned" existentes
 * eram ideias/rascunhos com data, então viram "draft" mantendo o plannedAt.
 *
 * Uso: node scripts/migrate-planned-to-draft.js [--prod] [--apply]
 * Sem --apply só mostra o que mudaria.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const useProd = process.argv.includes("--prod");
const apply = process.argv.includes("--apply");
const uri = useProd ? process.env.MONGO_URI_PROD : process.env.MONGO_URI_DEV;

(async () => {
  await mongoose.connect(uri);
  const posts = mongoose.connection.db.collection("blogposts");

  const planned = await posts
    .find({ status: "planned" }, { projection: { title: 1, plannedAt: 1, deletedAt: 1 } })
    .toArray();

  console.log(`${useProd ? "PRODUÇÃO" : "DEV"}: ${planned.length} post(s) "planned" → "draft"`);
  for (const p of planned) {
    console.log(
      `  ${p.plannedAt ? p.plannedAt.toISOString().slice(0, 10) : "sem data"}${p.deletedAt ? " (lixeira)" : ""}  ${p.title}`
    );
  }

  if (apply && planned.length) {
    const r = await posts.updateMany({ status: "planned" }, { $set: { status: "draft", published: false } });
    console.log(`Atualizados: ${r.modifiedCount}`);
  } else if (!apply) {
    console.log("Simulação. Rode com --apply para gravar.");
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
