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
    // Chamada curta usada nos emails (aviso de post novo e Envios). Se vazia, usa o excerpt.
    emailTeaser: { type: String, default: "" },
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
        values: ["tecnologia", "design", "carreira", "negocios", "marketing", "trafego", "growth"],
        message: "Categoria inválida. Valores permitidos: tecnologia, design, carreira, negocios, marketing, trafego, growth",
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

    // Avisar assinantes da categoria por email quando o post for publicado
    emailNotify: { type: Boolean, default: true },

    // Email preparado junto com o post; vira um envio em Envios ao publicar.
    // Campos vazios usam sugestões (assunto "Novo artigo: …", resumo do post).
    emailSubject: { type: String, trim: true, default: "" },
    emailPreheader: { type: String, trim: true, default: "" },
    emailAudience: {
      type: {
        type: String,
        enum: {
          values: ["post-category", "members", "all", "categories", "selected"],
          message: "Público do email inválido",
        },
        default: "post-category",
      },
      categories: { type: [String], default: [] },
      subscribers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Subscriber" }],
      excludeMembers: { type: Boolean, default: false },
    },
    publishedAt: Date,

    views: { type: Number, default: 0 },

    seo: {
      title: String,
      description: String,
      faqSchema: { type: Boolean, default: false },
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
