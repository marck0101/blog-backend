const mongoose = require("mongoose");
const slugify = require("slugify");
const { SLUGS: CATEGORY_SLUGS } = require("../config/categories");
const { readingMinutes } = require("../utils/readingTime");
const { normalizeTags } = require("../utils/tags");

// Leituras sugeridas escolhidas à mão (ex.: post-pilar → posts que aprofundam)
const MAX_RELATED_PICKS = 3;

// Texto alternativo de imagem: leitores de tela e buscadores leem até ~125 caracteres
const ALT_MAX = 125;
const altField = {
  type: String,
  trim: true,
  default: "",
  maxlength: [ALT_MAX, `O texto alternativo deve ter no máximo ${ALT_MAX} caracteres`],
};

// Endereço livre: nem o atual nem um antigo de outro post (o link antigo
// compartilhado abriria o post errado; ver previousSlugs, R-POST-17)
async function generateUniqueSlug(title, excludeId) {
  const base = slugify(title, { lower: true, strict: true });
  let slug = base;
  let counter = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = { $or: [{ slug }, { previousSlugs: slug }] };
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
    // Endereços que o post já teve: o link antigo leva ao atual (301, R-POST-17)
    previousSlugs: { type: [String], default: [], index: true },
    excerpt: String,
    // Resposta direta (BLUF): 1–3 frases logo abaixo do título com a conclusão do
    // artigo. É o trecho que buscadores e assistentes de IA citam; vira o
    // "abstract" do BlogPosting.
    directAnswer: {
      type: String,
      trim: true,
      default: "",
      maxlength: [400, "A resposta direta deve ter no máximo 400 caracteres"],
    },
    // Chamada curta usada nos emails (aviso de post novo e Envios). Se vazia, usa o excerpt.
    emailTeaser: { type: String, default: "" },
    content: {
      type: String,
      default: "",
    },
    // Minutos de leitura do content, recalculados ao salvar (cards não carregam o texto)
    // Sem default: post ainda sem cálculo fica sem o reloginho (em vez de "1 min")
    readingMinutes: { type: Number },

    // draft = rascunho | planned = agendado (publica sozinho em plannedAt) | published
    status: {
      type: String,
      enum: ["draft", "published", "planned"],
      default: "draft",
    },

    // Rascunho: data no calendário editorial. Agendado: data de publicação.
    plannedAt: { type: Date, default: null },

    category: {
      type: String,
      enum: {
        values: CATEGORY_SLUGS,
        message: `Categoria inválida. Valores permitidos: ${CATEGORY_SLUGS.join(", ")}`,
      },
      required: [true, "A categoria é obrigatória"],
    },

    // Assuntos do post (slugs, até 8): alimentam as próximas leituras e o schema
    tags: { type: [String], default: [], index: true, set: normalizeTags },
    // Próximas leituras fixadas pelo autor, em ordem; o resto vem do algoritmo
    relatedPosts: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "BlogPost" }],
      default: [],
      validate: {
        validator: (list) => list.length <= MAX_RELATED_PICKS,
        message: `Escolha no máximo ${MAX_RELATED_PICKS} leituras sugeridas`,
      },
    },

    // Season (série) opcional: slug de uma Season (gerenciadas no admin)
    season: { type: String, default: null, index: true },
    // Ordem do episódio dentro da season (navegação anterior/próximo)
    seasonOrder: { type: Number, default: null },

    coverImage: String,
    coverImageAlt: altField,

    gallery: [
      {
        _id: false,
        url: String,
        alt: altField,
      },
    ],

    // Perguntas frequentes no fim do post: aparecem para o leitor e viram FAQPage (schema.org)
    faq: [
      {
        _id: false,
        question: { type: String, trim: true, required: [true, "Pergunta do FAQ vazia"], maxlength: 200 },
        answer: { type: String, trim: true, required: [true, "Resposta do FAQ vazia"], maxlength: 1500 },
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
          values: ["post-category", "members", "all", "categories", "selected", "lists"],
          message: "Público do email inválido",
        },
        default: "post-category",
      },
      categories: { type: [String], default: [] },
      subscribers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Subscriber" }],
      lists: [{ type: mongoose.Schema.Types.ObjectId, ref: "AudienceList" }],
      excludeMembers: { type: Boolean, default: false },
    },
    publishedAt: Date,

    // Post no LinkedIn (perfil pessoal), preparado junto com o artigo.
    // Sai na publicação: texto + imagem próprios, link do artigo no 1º comentário.
    linkedin: {
      enabled: { type: Boolean, default: false },
      text: { type: String, default: "" },
      // Imagem do post; vazia usa a capa do artigo
      imageUrl: { type: String, default: "" },
      // Comentário com o link; {link} vira a URL do artigo
      comment: { type: String, default: "" },

      // Preenchidos pelo sistema
      // posting = em andamento (ou interrompido: conferir no LinkedIn antes de repetir)
      status: { type: String, enum: ["idle", "posting", "posted", "failed"], default: "idle" },
      postUrn: { type: String, default: "" },
      commentUrn: { type: String, default: "" },
      attemptedAt: Date,
      postedAt: Date,
      error: { type: String, default: "" },
    },

    views: { type: Number, default: 0 },

    // Vitrine da home: posição entre os fixados (1–3) ou null
    pinnedOrder: { type: Number, default: null, min: 1, max: 3 },
    // Destaques da semana: auto = entra pelo ranking de leituras dos últimos 7 dias
    highlight: { type: String, enum: ["auto", "force", "hide"], default: "auto" },

    // Engajamento do leitor (totais; o detalhe por dia fica em PostDailyStat)
    favorites: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    // Comentários aprovados
    commentsCount: { type: Number, default: 0 },

    seo: {
      title: String,
      description: String,
    },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Ganchos sem next(): o mongoose 9 tirou o callback (vale a função síncrona ou
// a promise da async); este formato funciona também nas versões anteriores.

// Gera slug automático ao criar (ou quando slug está vazio)
BlogPostSchema.pre("validate", async function () {
  if (this.slug || !this.title) return;
  this.slug = await generateUniqueSlug(this.title, this._id);
});

// Tempo de leitura acompanha o conteúdo, em qualquer forma de salvar
BlogPostSchema.pre("validate", function () {
  if (this.isModified("content") || this.isNew) this.readingMinutes = readingMinutes(this.content);
});

BlogPostSchema.pre("findOneAndUpdate", function () {
  const update = this.getUpdate();
  const content = update?.content ?? update?.$set?.content;
  if (typeof content !== "string") return;
  if (update.$set) update.$set.readingMinutes = readingMinutes(content);
  else update.readingMinutes = readingMinutes(content);
});

// Regenera slug ao atualizar título via findByIdAndUpdate (apenas se slug não for enviado)
BlogPostSchema.pre("findOneAndUpdate", async function () {
  const update = this.getUpdate();
  const title = update?.title || update?.$set?.title;
  const providedSlug = update?.slug || update?.$set?.slug;

  if (!title || providedSlug) return;

  const docId = this.getQuery()._id;
  const slug = await generateUniqueSlug(title, docId);

  if (update.$set) update.$set.slug = slug;
  else update.slug = slug;
});

module.exports =
  mongoose.models.BlogPost ||
  mongoose.model("BlogPost", BlogPostSchema);
