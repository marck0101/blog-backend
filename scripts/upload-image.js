/**
 * Sobe uma imagem local para o Firebase Storage (mesmo caminho do upload do painel:
 * WebP até 1200px + versões 480w e 800w) e imprime a URL para usar no content.html.
 *
 * Uso:
 *   node scripts/upload-image.js content/<pasta>/figura.webp
 *
 * Precisa de FIREBASE_SERVICE_ACCOUNT_JSON e FIREBASE_STORAGE_BUCKET no .env.
 */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const { saveCover } = require("../app/services/coverImage.service");
const { getBucket } = require("../app/config/firebase.admin");

async function main(file = process.argv[2]) {
  if (!file || !fs.existsSync(file)) throw new Error("Informe o caminho de uma imagem existente");
  const bucket = getBucket();
  if (!bucket) throw new Error("Firebase não configurado no .env");
  const { filename, width, height } = await saveCover(bucket, fs.readFileSync(file));
  const url = `https://storage.googleapis.com/${bucket.name}/${filename}`;
  console.log(JSON.stringify({ url, width, height }));
  return { url, width, height };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { main };
