/**
 * Imagens enviadas antes das variantes: cria as versões menores (-480w, -800w)
 * que o srcset do blog pede e troca o cache de 1h (padrão do Storage) por 1 ano.
 * Rode ANTES de publicar o frontend com srcset — sem as variantes, o navegador
 * cai no fallback da imagem principal (funciona, mas sem a economia).
 *
 *   node scripts/backfill-cover-variants.js            → mostra o que seria feito (dry run)
 *   node scripts/backfill-cover-variants.js --apply    → grava no bucket
 *
 * Usa a mesma credencial do upload (FIREBASE_SERVICE_ACCOUNT_JSON ou service-account.json).
 */
require("dotenv").config();
const admin = require("../app/config/firebase.admin");
const { CACHE_CONTROL, VARIANT_WIDTHS, variantName, isVariant, saveVariants } = require("../app/services/coverImage.service");

const apply = process.argv.includes("--apply");

(async () => {
  if (!admin.apps.length) throw new Error("Firebase Admin sem credencial");
  const bucket = admin.storage().bucket();
  console.log(`Bucket: ${bucket.name} | ${apply ? "GRAVANDO" : "dry run"}`);

  const [files] = await bucket.getFiles({ prefix: "covers/" });
  const names = new Set(files.map((f) => f.name));
  let created = 0;
  let recached = 0;

  for (const file of files) {
    if (!file.name.endsWith(".webp")) continue;

    if (file.metadata.cacheControl !== CACHE_CONTROL) {
      recached++;
      console.log(`cache  ${file.name} (${file.metadata.cacheControl || "padrão"})`);
      if (apply) await file.setMetadata({ cacheControl: CACHE_CONTROL });
    }

    if (isVariant(file.name)) continue;
    const missing = VARIANT_WIDTHS.filter((w) => !names.has(variantName(file.name, w)));
    if (!missing.length) continue;

    created++;
    console.log(`criar  ${missing.map((w) => variantName(file.name, w)).join(", ")}`);
    if (apply) {
      const [buffer] = await file.download();
      await saveVariants(bucket, file.name, buffer);
    }
  }

  console.log(`\n${created} imagens sem variantes, ${recached} arquivos com cache curto.`);
  if (!apply && (created || recached)) console.log("Rode com --apply para gravar.");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
