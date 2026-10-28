/**
 * Imagens no texto dos posts sem width/height: o navegador não sabe a altura
 * antes de baixar, e o texto abaixo "pula" quando cada imagem chega (CLS).
 * Este script baixa cada imagem, lê o tamanho real e grava width/height no <img>.
 * O editor já grava esses atributos nas imagens novas (RichTextEditor do front).
 *
 *   node scripts/backfill-content-image-sizes.js            → mostra o que seria alterado (dry run)
 *   node scripts/backfill-content-image-sizes.js --apply    → grava
 *
 * Não mexe no updatedAt (o sitemap não acusa mudança de conteúdo).
 * Usa MONGO_URI_PROD com NODE_ENV=production, senão MONGO_URI_DEV.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const sharp = require("sharp");
const BlogPost = require("../app/models/blogpost.model");

const MONGO_URI =
  process.env.NODE_ENV === "production"
    ? process.env.MONGO_URI_PROD
    : process.env.MONGO_URI_DEV;

const apply = process.argv.includes("--apply");

const IMG_RE = /<img\b[^>]*>/gi;
const hasSize = (tag) => /\swidth="\d+"/.test(tag) && /\sheight="\d+"/.test(tag);
const srcOf = (tag) => tag.match(/\ssrc="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");

// Mesma imagem em vários posts: baixa uma vez
const sizes = new Map();

async function imageSize(url) {
  if (!sizes.has(url)) {
    sizes.set(
      url,
      (async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`${res.status}`);
        const { width, height } = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
        return { width, height };
      })().catch((err) => {
        console.warn(`  ! ${url} (${err.message})`);
        return null;
      })
    );
  }
  return sizes.get(url);
}

async function withSizes(html) {
  let changed = 0;
  const tags = [...new Set(html.match(IMG_RE) || [])].filter((tag) => !hasSize(tag));
  for (const tag of tags) {
    const src = srcOf(tag);
    const size = src && (await imageSize(src));
    if (!size?.width || !size?.height) continue;
    const fixed = tag
      .replace(/\s(width|height)="[^"]*"/g, "")
      .replace(/^<img\b/i, `<img width="${size.width}" height="${size.height}"`);
    html = html.split(tag).join(fixed);
    changed++;
  }
  return { html, changed };
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log(`Banco: ${process.env.NODE_ENV === "production" ? "PRODUÇÃO" : "local"} | ${apply ? "GRAVANDO" : "dry run"}`);

  const posts = await BlogPost.find({ content: /<img\b/i }, { title: 1, content: 1 }).lean();
  let total = 0;

  for (const post of posts) {
    const { html, changed } = await withSizes(post.content);
    if (!changed) continue;
    total += changed;
    console.log(`${changed} imagem(ns) → ${post.title}`);
    if (apply) {
      await BlogPost.updateOne({ _id: post._id }, { $set: { content: html } }, { timestamps: false });
    }
  }

  console.log(`\n${total} imagens sem tamanho em ${posts.length} posts com imagem.`);
  if (!apply && total) console.log("Rode com --apply para gravar.");
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { withSizes };
