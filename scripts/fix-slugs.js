require("dotenv").config();
const mongoose = require("mongoose");
const slugify = require("slugify");

const MONGO_URI =
  process.env.NODE_ENV === "production"
    ? process.env.MONGO_URI_PROD
    : process.env.MONGO_URI_DEV;

function isCleanSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

async function generateUniqueSlug(title, excludeId, BlogPost) {
  const base = slugify(title, { lower: true, strict: true });
  let slug = base;
  let counter = 1;

  while (true) {
    const query = { slug };
    if (excludeId) query._id = { $ne: excludeId };
    const existing = await BlogPost.findOne(query).select("_id");
    if (!existing) break;
    slug = `${base}-${counter++}`;
  }

  return slug;
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ MongoDB conectado");

  const BlogPost = mongoose.model(
    "BlogPost",
    new mongoose.Schema({ title: String, slug: String }, { strict: false })
  );

  const posts = await BlogPost.find({}).select("_id title slug");
  console.log(`\nTotal de posts: ${posts.length}`);

  let fixed = 0;
  let skipped = 0;

  for (const post of posts) {
    if (!post.slug || isCleanSlug(post.slug)) {
      skipped++;
      continue;
    }

    const newSlug = await generateUniqueSlug(post.title, post._id, BlogPost);

    if (newSlug === post.slug) {
      skipped++;
      continue;
    }

    await BlogPost.updateOne({ _id: post._id }, { slug: newSlug });
    console.log(`  ✏️  "${post.slug}"  →  "${newSlug}"  (${post.title})`);
    fixed++;
  }

  console.log(`\nFinalizado: ${fixed} slugs corrigidos, ${skipped} já estavam limpos.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Erro:", err.message);
  process.exit(1);
});
