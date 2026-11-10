const { z } = require("zod");
const BlogPost = require("../models/blogpost.model");
const { text, id, dateInput } = require("./fields");
const { audienceSchema } = require("./audience.schema");
const { MAX_PINNED } = require("../config/showcase");

/**
 * Formato do post que o painel envia (editor, calendário, lista de posts,
 * seção LinkedIn). Tudo opcional: a edição pode mandar só um campo
 * ({ plannedAt } do calendário, { status } da ação em massa).
 *
 * O que NÃO está aqui é descartado: métricas (views, favorites, shares,
 * commentsCount), lixeira (deletedAt), vitrine (pinnedOrder, highlight),
 * publishedAt (decidido pelo servidor, R-POST-06), previousSlugs (R-POST-17),
 * campos de sistema do LinkedIn e qualquer operador do MongoDB (R-POST-15).
 *
 * Regras de negócio (título com 3+ caracteres, categoria existente, data do
 * agendado…) ficam em controllers/posts/post.rules.js.
 */

const ALT_MAX = 125; // leitores de tela e buscadores (igual ao model)

// Tipos do model (inclui "post-category": segue a categoria do post)
const emailAudience = audienceSchema(BlogPost.schema.path("emailAudience.type").enumValues);

// Só os campos que o painel edita; status, URNs e erros são do sistema
const linkedin = z.object({
  enabled: z.boolean().optional(),
  text: text(3000).optional(),
  imageUrl: text(2000).optional(),
  comment: text(1250).optional(),
});

const postBody = z.object({
  title: text(300).optional(),
  slug: text(200).optional(),
  excerpt: text(500).optional(),
  directAnswer: text(400).optional(),
  content: z.string().optional(),
  category: text(60).optional(),
  // Lista ou "a, b"; o model normaliza (slugs, até 8)
  tags: z.union([z.array(text(100)).max(50), text(1000)]).optional(),
  relatedPosts: z.array(id).max(20).optional(),
  season: text(120).nullable().optional(),
  seasonOrder: z.union([z.number(), text(10), z.null()]).optional(),
  status: z.enum(["draft", "planned", "published"]).optional(),
  // Legado: o painel ainda manda junto com status
  published: z.boolean().optional(),
  plannedAt: dateInput.optional(),

  coverImage: text(2000).optional(),
  coverImageAlt: text(ALT_MAX).optional(),
  gallery: z.array(z.object({ url: text(2000), alt: text(ALT_MAX).optional() })).max(100).optional(),
  faq: z.array(z.object({ question: text(200), answer: text(1500) })).max(50).optional(),
  seo: z.object({ title: text(200).optional(), description: text(500).optional() }).optional(),

  emailNotify: z.boolean().optional(),
  emailTeaser: text(3000).optional(),
  emailSubject: text(300).optional(),
  emailPreheader: text(500).optional(),
  emailAudience: emailAudience.optional(),

  linkedin: linkedin.optional(),
});

/* ================= OUTRAS ROTAS DE POST ================= */

// Vitrine: posts fixados no topo da home, na ordem enviada (R-VIT-01)
const pinnedBody = z.object({
  ids: z
    .array(id, { error: (issue) => (issue.input === undefined ? "Envie a lista de posts fixados" : undefined) })
    .max(MAX_PINNED, `Fixe no máximo ${MAX_PINNED} posts`),
});

// Regra de destaque da semana (R-VIT-02)
const highlightBody = z.object({
  highlight: z.enum(["auto", "force", "hide"], { error: "Opção inválida" }),
});

// Remover uma imagem da galeria. Texto obrigatório: { "$ne": null } tiraria todas
const removeImageBody = z.object({
  imageUrl: z.string({ error: (issue) => (issue.input === undefined ? "Informe a imagem a remover" : undefined) }).trim().min(1, "Informe a imagem a remover").max(2000),
});

// Evento do leitor (público). Os tipos e canais válidos são conferidos em
// services/postStats.service.js (recordEvent), que é quem os conhece.
const engageBody = z.object({
  type: text(30).optional(),
  channel: text(30).optional(),
});

module.exports = { postBody, pinnedBody, highlightBody, removeImageBody, engageBody };
