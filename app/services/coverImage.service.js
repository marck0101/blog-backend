const sharp = require("sharp");

// Imagens enviadas pelo painel: a principal (até 1200px) e versões menores para
// o navegador escolher pelo srcset (card no celular ≈ 400px, grade ≈ 800px).
// O frontend monta os nomes a partir da URL principal (src/utils/imageUrl.js):
//   covers/123.webp → covers/123-480w.webp, covers/123-800w.webp
const MAIN_WIDTH = 1200;
const VARIANT_WIDTHS = [480, 800];

// Nome de arquivo único por upload (timestamp): nunca muda de conteúdo, então o
// navegador e a CDN podem guardar por 1 ano sem revalidar
const CACHE_CONTROL = "public, max-age=31536000, immutable";

const variantName = (filename, width) => filename.replace(/\.webp$/, `-${width}w.webp`);
const isVariant = (filename) => /-\d+w\.webp$/.test(filename);

function toWebp(input, width) {
  return sharp(input).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
}

async function saveFile(bucket, filename, buffer) {
  const fileRef = bucket.file(filename);
  await fileRef.save(buffer, { metadata: { contentType: "image/webp", cacheControl: CACHE_CONTROL } });
  await fileRef.makePublic();
}

// Gera as versões menores a partir da principal
async function saveVariants(bucket, filename, mainBuffer) {
  await Promise.all(
    VARIANT_WIDTHS.map(async (width) => saveFile(bucket, variantName(filename, width), await toWebp(mainBuffer, width)))
  );
}

/** Converte, grava a principal e as variantes. Retorna { filename, width, height }. */
async function saveCover(bucket, input) {
  const filename = `covers/${Date.now()}.webp`;
  const main = await toWebp(input, MAIN_WIDTH);
  await saveFile(bucket, filename, main);
  await saveVariants(bucket, filename, main);
  const { width, height } = await sharp(main).metadata();
  return { filename, width, height };
}

module.exports = { CACHE_CONTROL, VARIANT_WIDTHS, variantName, isVariant, saveCover, saveVariants };
