const { notifyNewPost } = require("../../services/campaign.service");
const { safeShareArticle } = require("../../services/linkedin.service");
const { sanitizeHtml } = require("../../utils/sanitizeHtml");
const { SLUGS: ALLOWED_CATEGORIES } = require("../../config/categories");

/**
 * Regras do post usadas por mais de um controller (SISTEMA.md, seção 2):
 * o que o editor pode gravar, validação, status/publicação e o anúncio da
 * primeira publicação. Os controllers só orquestram: lêem a requisição,
 * chamam estas regras e respondem.
 */

// Campos que as rotas públicas podem devolver. Lista de permitidos (não de
// proibidos): campo novo de admin (email, LinkedIn, views…) nunca vaza por padrão.
const PUBLIC_FIELDS =
  "_id title slug excerpt content category coverImage coverImageAlt gallery faq seo season seasonOrder publishedAt createdAt updatedAt commentsCount";

// Cards da vitrine (fixados e destaques): sem o conteúdo inteiro
const CARD_FIELDS = "_id title slug excerpt category coverImage coverImageAlt season publishedAt createdAt commentsCount";

/* ================= O QUE O EDITOR PODE GRAVAR ================= */

// Preenchidos pelo sistema (métricas, lixeira, vitrine, datas): o editor não
// grava direto. publishedAt é decidido aqui (R-POST-06), nunca pelo navegador.
const SYSTEM_FIELDS = [
  "_id", "__v", "views", "favorites", "shares", "commentsCount", "deletedAt",
  "pinnedOrder", "highlight", "publishedAt", "createdAt", "updatedAt",
];
// Texto ou vazio; objeto aqui viraria operador do MongoDB
const TEXT_FIELDS = [
  "title", "slug", "excerpt", "content", "category", "season", "coverImage", "coverImageAlt",
  "emailTeaser", "emailSubject", "emailPreheader", "status",
];

/** Corpo do editor → dados do post: sem operadores ($inc…), caminhos com ponto e campos do sistema */
function postInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Dados inválidos" };
  const data = {};
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith("$") || key.includes(".") || SYSTEM_FIELDS.includes(key)) continue;
    data[key] = value;
  }
  const wrong = TEXT_FIELDS.find((f) => data[f] != null && typeof data[f] !== "string");
  if (wrong) return { error: `Valor inválido no campo ${wrong}` };
  // HTML do post: só o que o editor produz (SEC-01)
  if (data.content != null) data.content = sanitizeHtml(data.content);
  return { data };
}

// Do LinkedIn, o painel só edita o conteúdo; status, URNs e erros são do sistema
const LINKEDIN_EDITABLE = ["enabled", "text", "imageUrl", "comment"];

/** Edição: linkedin { … } → "linkedin.campo" só dos campos editáveis (não apaga os do sistema) */
function pickLinkedIn(data) {
  if (!data.linkedin || typeof data.linkedin !== "object") {
    delete data.linkedin;
    return;
  }
  const input = data.linkedin;
  delete data.linkedin;
  for (const field of LINKEDIN_EDITABLE) {
    if (input[field] !== undefined) data[`linkedin.${field}`] = input[field];
  }
}

/** Criação: só os campos editáveis do LinkedIn */
function newLinkedIn(input) {
  return Object.fromEntries(LINKEDIN_EDITABLE.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]));
}

/* ================= NORMALIZAÇÃO E VALIDAÇÃO ================= */

/** Season vazia vira null (post sem season); ordem vazia também */
function normalizeSeason(data) {
  if (data.season !== undefined && !data.season) data.season = null;
  if (data.seasonOrder !== undefined) {
    const order = parseInt(data.seasonOrder, 10);
    data.seasonOrder = Number.isFinite(order) ? order : null;
  }
}

// Data "YYYY-MM-DD" do formulário → meio-dia UTC: cai no mesmo dia em todos os
// fusos do Brasil (meia-noite UTC apareceria no dia anterior) e fica antes do
// cron diário das 12h UTC.
function normalizePlannedAt(data) {
  if (typeof data.plannedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.plannedAt)) {
    data.plannedAt = `${data.plannedAt}T12:00:00.000Z`;
  }
}

// Status do post:
//   draft     = rascunho (pode ter plannedAt: data no calendário editorial)
//   planned   = agendado: pronto, vai ao ar sozinho na data (cron diário)
//   published = no ar
// "Na lixeira" é deletedAt, independente do status.
function effectiveStatus(data, existing) {
  if (data.status) return data.status;
  if (data.published !== undefined) return data.published ? "published" : "draft";
  return existing?.status ?? "draft";
}

/** R-POST-01 a 04. Devolve a mensagem de erro para a pessoa, ou null. */
function validatePost(data, isCreate, existing = null) {
  if (isCreate || data.title !== undefined) {
    const title = (data.title || "").trim();
    if (title.length < 3)
      return "O título deve ter pelo menos 3 caracteres";
  }

  const status = effectiveStatus(data, existing);

  // Rascunho pode ser só uma ideia; agendado e publicado precisam de conteúdo
  if (status !== "draft") {
    const content = (data.content ?? existing?.content ?? "").trim();
    if (content.length < 10)
      return "O conteúdo deve ter pelo menos 10 caracteres para agendar ou publicar";
  }

  if (status === "planned") {
    const plannedAt = data.plannedAt !== undefined ? data.plannedAt : existing?.plannedAt;
    if (!plannedAt || Number.isNaN(new Date(plannedAt).getTime()))
      return "Informe a data de publicação do post agendado";
  }
  if (isCreate && data.category === undefined) {
    return "A categoria é obrigatória";
  }
  if (data.category !== undefined && !ALLOWED_CATEGORIES.includes(data.category)) {
    return `Categoria inválida. Valores permitidos: ${ALLOWED_CATEGORIES.join(", ")}`;
  }
  return null;
}

/** Mantém `published` (legado) igual ao `status` e preenche publishedAt ao publicar */
function syncPublished(data) {
  // Suporte a legado: se `status` não veio, deriva do boolean `published`
  if (!data.status && data.published !== undefined) {
    data.status = data.published === true ? "published" : "draft";
  }
  // Atualização parcial (sem status nem published) não mexe na publicação
  if (!data.status) return;

  if (data.status === "published") {
    data.published = true;
    if (!data.publishedAt) data.publishedAt = new Date();
  } else {
    // Rascunho e agendado mantêm a data planejada (calendário)
    data.published = false;
  }
}

/* ================= PUBLICAÇÃO E HISTÓRICO ================= */

// Falha no email não pode impedir a publicação do post
async function safeNotify(post) {
  try {
    await notifyNewPost(post);
  } catch (err) {
    console.error("[EMAIL]", err);
  }
}

// Primeira publicação (R-POST-09): email e LinkedIn em paralelo (cabem juntos
// no tempo da função serverless). Nenhum dos dois desfaz a publicação se falhar.
function announcePost(post) {
  return Promise.all([safeNotify(post), safeShareArticle(post)]);
}

// Quem fez a alteração, para o histórico de versões
const revisionAuthor = (req) => ({ id: req.userId, name: req.user?.name || req.user?.email || "" });

module.exports = {
  PUBLIC_FIELDS,
  CARD_FIELDS,
  postInput,
  pickLinkedIn,
  newLinkedIn,
  normalizeSeason,
  normalizePlannedAt,
  validatePost,
  syncPublished,
  announcePost,
  revisionAuthor,
};
