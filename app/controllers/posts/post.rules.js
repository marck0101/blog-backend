const slugify = require("slugify");
const mongoose = require("mongoose");
const { notifyNewPost } = require("../../services/campaign.service");
const { safeShareArticle } = require("../../services/linkedin.service");
const { pingPost } = require("../../services/indexnow.service");
const { sanitizeHtml } = require("../../utils/sanitizeHtml");
const { SLUGS: ALLOWED_CATEGORIES } = require("../../config/categories");
const { DAILY_JOB_UTC_HOUR } = require("../../config/schedule");
const { addDays, dayKey, parseDayKey } = require("../../utils/dates");
const { normalizeTags } = require("../../utils/tags");

/**
 * Regras do post usadas por mais de um controller (SISTEMA.md, seção 2):
 * o que o editor pode gravar, validação, status/publicação e o anúncio da
 * primeira publicação. Os controllers só orquestram: lêem a requisição,
 * chamam estas regras e respondem.
 */

// Campos que as rotas públicas podem devolver. Lista de permitidos (não de
// proibidos): campo novo de admin (email, LinkedIn, views…) nunca vaza por padrão.
const PUBLIC_FIELDS =
  "_id title slug excerpt directAnswer content category tags coverImage coverImageAlt gallery faq seo season seasonOrder publishedAt createdAt updatedAt commentsCount readingMinutes";

// Cards da vitrine (fixados e destaques): sem o conteúdo inteiro
const CARD_FIELDS = "_id title slug excerpt category coverImage coverImageAlt season publishedAt createdAt commentsCount readingMinutes";

// Leituras sugeridas no fim do post (manuais + automáticas)
const RELATED_LIMIT = 3;

/* ================= O QUE O EDITOR GRAVA ================= */
// O formato (campos permitidos, tipos, tamanhos) é conferido antes, pelo
// esquema da rota: app/validation/posts.schemas.js. Aqui só o que depende dele.

/** HTML do post: só o que o editor produz (SEC-01) */
function sanitizeContent(data) {
  if (data.content != null) data.content = sanitizeHtml(data.content);
}

/**
 * Edição: linkedin { text, … } → "linkedin.text": grava só os campos enviados
 * sem apagar os do sistema (status, URNs, erro). O esquema já limitou aos
 * campos editáveis.
 */
function pickLinkedIn(data) {
  if (!data.linkedin) return;
  for (const [field, value] of Object.entries(data.linkedin)) data[`linkedin.${field}`] = value;
  delete data.linkedin;
}

/* ================= NORMALIZAÇÃO E VALIDAÇÃO ================= */

/**
 * Slug digitado no editor vira endereço válido ("Meu Post!" → "meu-post"), com a
 * mesma regra do slug gerado do título. Vazio fica vazio: o model gera do título.
 */
function normalizeSlug(data) {
  if (typeof data.slug === "string") data.slug = slugify(data.slug, { lower: true, strict: true });
}

// Tags em slug; leituras sugeridas: ids válidos, sem repetir e sem o próprio post
function normalizeLinks(data, selfId = null) {
  if (data.tags !== undefined) data.tags = normalizeTags(data.tags);
  if (data.relatedPosts !== undefined) {
    const ids = Array.isArray(data.relatedPosts) ? data.relatedPosts : [];
    data.relatedPosts = [...new Set(ids.map((id) => String(id?._id ?? id)))]
      .filter((id) => mongoose.isValidObjectId(id) && id !== String(selfId))
      .slice(0, RELATED_LIMIT);
  }
}

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

/** Primeiro dia que ainda dá para agendar: hoje, se a rotina das 9h não rodou; senão amanhã */
function firstSchedulableDay(now = new Date()) {
  const today = dayKey(now);
  const todaysJob = new Date(`${today}T${String(DAILY_JOB_UTC_HOUR).padStart(2, "0")}:00:00.000Z`);
  return now < todaysJob ? today : addDays(today, 1);
}

/**
 * R-POST-16: agendado vai ao ar na rotina diária (~9h). Agendar para um dia que
 * a rotina já passou deixaria o post parado até o dia seguinte, como "atrasado".
 * Só vale quando a data é definida ou mudada: editar um agendado sem mexer na
 * data (inclusive um atrasado) continua permitido.
 */
function scheduleDateError(plannedAt, existing, now) {
  // "YYYY-MM-DD" do formulário já é o dia; new Date() dele seria meia-noite UTC (dia anterior no Brasil)
  const day = parseDayKey(plannedAt) || dayKey(new Date(plannedAt));
  const unchanged = existing?.status === "planned" && existing.plannedAt && dayKey(new Date(existing.plannedAt)) === day;
  if (unchanged) return null;

  const first = firstSchedulableDay(now);
  if (day >= first) return null;
  return day === dayKey(now)
    ? "A publicação automática de hoje já rodou (9h). Agende para amanhã ou use “Publicar agora”."
    : "Essa data já passou. Escolha uma data a partir de hoje.";
}

/** R-POST-01 a 04 e 16. Devolve a mensagem de erro para a pessoa, ou null. */
function validatePost(data, isCreate, existing = null, now = new Date()) {
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
    const scheduleError = scheduleDateError(plannedAt, existing, now);
    if (scheduleError) return scheduleError;
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

// Primeira publicação (R-POST-09): email, LinkedIn e IndexNow em paralelo
// (cabem juntos no tempo da função serverless). Nenhum deles desfaz a
// publicação se falhar.
function announcePost(post) {
  return Promise.all([safeNotify(post), safeShareArticle(post), pingPost(post)]);
}

// Editor mostra título e status das leituras sugeridas, não só o id.
// Chamar só na resposta: revisões e avisos usam os ids.
const RELATED_EDITOR_FIELDS = "_id title slug status";
const withRelatedForEditor = (post) => post.populate("relatedPosts", RELATED_EDITOR_FIELDS);

// Quem fez a alteração, para o histórico de versões
const revisionAuthor = (req) => ({ id: req.userId, name: req.user?.name || req.user?.email || "" });

module.exports = {
  PUBLIC_FIELDS,
  CARD_FIELDS,
  RELATED_LIMIT,
  RELATED_EDITOR_FIELDS,
  sanitizeContent,
  pickLinkedIn,
  normalizeSlug,
  normalizeSeason,
  normalizeLinks,
  normalizePlannedAt,
  validatePost,
  firstSchedulableDay,
  syncPublished,
  announcePost,
  withRelatedForEditor,
  revisionAuthor,
};
