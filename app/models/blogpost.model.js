const mongoose = require("mongoose");
const slugify = require("slugify");

async function generateUniqueSlug(title, excludeId) {
  const base = slugify(title, { lower: true, strict: true });
  let slug = base;
  let counter = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = { slug };
    if (excludeId) query._id = { $ne: excludeId };
    const existing = await mongoose.models.BlogPost.findOne(query);
    if (!existing) break;
    slug = `${base}-${counter++}`;
  }

  return slug;
}

const BlogPostSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "O título é obrigatório"],
      minlength: [3, "O título deve ter pelo menos 3 caracteres"],
    },
    slug: {
      type: String,
      unique: true,
      index: true,
    },
    excerpt: String,
    content: {
      type: String,
      default: "",
    },

    status: {
      type: String,
      enum: ["draft", "published", "planned"],
      default: "draft",
    },

    plannedAt: { type: Date, default: null },

    category: {
      type: String,
      enum: {
        values: ["marketing", "trafego", "growth", "tecnologia"],
        message: "Categoria inválida. Valores permitidos: marketing, trafego, growth, tecnologia",
      },
      required: [true, "A categoria é obrigatória"],
    },

    coverImage: String,

    gallery: [
      {
        _id: false,
        url: String,
        alt: String,
      },
    ],

    published: { type: Boolean, default: false },
    publishedAt: Date,

    seo: {
      title: String,
      description: String,
    },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Gera slug automático ao criar (ou quando slug está vazio)
BlogPostSchema.pre("validate", async function (next) {
  if (this.slug) return next();
  if (!this.title) return next();
  this.slug = await generateUniqueSlug(this.title, this._id);
  next();
});

// Regenera slug ao atualizar título via findByIdAndUpdate (apenas se slug não for enviado)
BlogPostSchema.pre("findOneAndUpdate", async function (next) {
  const update = this.getUpdate();
  const title = update?.title || update?.$set?.title;
  const providedSlug = update?.slug || update?.$set?.slug;

  if (!title || providedSlug) return next();

  const docId = this.getQuery()._id;
  const slug = await generateUniqueSlug(title, docId);

  if (update.$set) update.$set.slug = slug;
  else update.slug = slug;

  next();
});

module.exports =
  mongoose.models.BlogPost ||
  mongoose.model("BlogPost", BlogPostSchema);
