const jwt = require("jsonwebtoken");
const BlogPost = require("../models/blogpost.model");
const LinkedInAccount = require("../models/linkedinAccount.model");
const { SITE_URL, API_URL } = require("../config/urls");

/**
 * Integração com o LinkedIn (perfil pessoal, produto "Share on LinkedIn").
 *
 * Fluxo ao publicar um artigo com linkedin.enabled:
 *   1. sobe a imagem (linkedin.imageUrl ou a capa) pela Images API
 *   2. cria o post com o texto próprio do LinkedIn
 *   3. comenta o link do artigo (fixar o comentário só dá pelo app: a API não tem)
 *
 * Variáveis: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI
 * (ex.: https://api.blog.marck0101.com.br/api/linkedin/callback) e, opcional,
 * LINKEDIN_API_VERSION (YYYYMM; cada versão vale ~1 ano).
 */

const API = "https://api.linkedin.com";
const OAUTH = "https://www.linkedin.com/oauth/v2";
const SCOPES = ["openid", "profile", "w_member_social"];
const API_VERSION = process.env.LINKEDIN_API_VERSION || "202609";
const REQUEST_TIMEOUT_MS = 8000;

// Texto padrão do comentário; {link} vira a URL do artigo (igual ao do painel,
// em src/utils/linkedin.js do blog-panel)
const DEFAULT_COMMENT = "Artigo completo no blog: {link}";

function isConfigured() {
  return Boolean(
    process.env.LINKEDIN_CLIENT_ID &&
      process.env.LINKEDIN_CLIENT_SECRET &&
      process.env.LINKEDIN_REDIRECT_URI
  );
}

/* ================= OAUTH ================= */

// state assinado: protege o callback e diz para onde voltar no painel
function authorizationUrl(returnTo = "/admin/posts") {
  const state = jwt.sign({ purpose: "linkedin", returnTo }, process.env.JWT_SECRET, {
    expiresIn: "10m",
  });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
    state,
    scope: SCOPES.join(" "),
  });
  return `${OAUTH}/authorization?${params}`;
}

function verifyState(state) {
  const payload = jwt.verify(state, process.env.JWT_SECRET);
  if (payload.purpose !== "linkedin") throw new Error("state inválido");
  // Só caminhos internos do painel
  return typeof payload.returnTo === "string" && payload.returnTo.startsWith("/admin")
    ? payload.returnTo
    : "/admin/posts";
}

async function connectWithCode(code) {
  const tokenRes = await fetch(`${OAUTH}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.LINKEDIN_CLIENT_ID,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET,
      redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const token = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(token.error_description || token.error || "Falha ao obter token do LinkedIn");
  }

  const meRes = await fetch(`${API}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const me = await meRes.json();
  if (!meRes.ok || !me.sub) throw new Error("Não foi possível ler o perfil do LinkedIn");

  await LinkedInAccount.deleteMany({});
  return LinkedInAccount.create({
    personUrn: `urn:li:person:${me.sub}`,
    name: me.name,
    picture: me.picture,
    accessToken: token.access_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
    scope: token.scope,
  });
}

async function getStatus() {
  const account = await LinkedInAccount.findOne().lean();
  if (!account) return { configured: isConfigured(), connected: false };

  const daysLeft = Math.floor((new Date(account.expiresAt) - Date.now()) / 86400000);
  return {
    configured: isConfigured(),
    connected: daysLeft >= 0,
    expired: daysLeft < 0,
    name: account.name,
    picture: account.picture,
    expiresAt: account.expiresAt,
    daysLeft: Math.max(daysLeft, 0),
  };
}

async function disconnect() {
  await LinkedInAccount.deleteMany({});
}

async function getActiveAccount() {
  const account = await LinkedInAccount.findOne().select("+accessToken");
  if (!account) throw new Error("LinkedIn não conectado");
  if (account.expiresAt <= new Date()) throw new Error("Conexão com o LinkedIn expirou; reconecte no painel");
  return account;
}

/* ================= API REST ================= */

async function linkedinFetch(account, path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      "LinkedIn-Version": API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let message = detail;
    try {
      message = JSON.parse(detail).message || detail;
    } catch {
      /* resposta não-JSON */
    }
    throw new Error(`LinkedIn ${res.status}: ${message}`.slice(0, 300));
  }
  return res;
}

async function uploadImage(account, imageUrl) {
  // Uploads antigos guardavam caminho relativo à API
  const absolute = /^https?:\/\//.test(imageUrl) ? imageUrl : `${API_URL}${imageUrl}`;
  const source = await fetch(absolute, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!source.ok) throw new Error(`Não foi possível baixar a imagem (${source.status})`);
  const bytes = Buffer.from(await source.arrayBuffer());

  const init = await linkedinFetch(account, "/rest/images?action=initializeUpload", {
    method: "POST",
    body: { initializeUploadRequest: { owner: account.personUrn } },
  });
  const { value } = await init.json();

  const put = await fetch(value.uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${account.accessToken}` },
    body: bytes,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!put.ok) throw new Error(`Falha ao enviar a imagem ao LinkedIn (${put.status})`);

  return value.image; // urn:li:image:...
}

// Texto do post no formato "little": caracteres reservados precisam de "\"
// ou o LinkedIn corta o texto. "#palavra" continua virando hashtag.
function toLittleText(text) {
  return text
    .replace(/[\\|{}@[\]()<>*_~]/g, (c) => `\\${c}`)
    .replace(/#(?![\p{L}\p{N}])/gu, "\\#");
}

function articleUrl(post) {
  const u = new URL(`${SITE_URL}/blog/${post.slug}`);
  u.searchParams.set("utm_source", "linkedin");
  u.searchParams.set("utm_medium", "social");
  u.searchParams.set("utm_campaign", `post-${post.slug}`.slice(0, 80));
  u.searchParams.set("utm_content", "comentario");
  return u.toString();
}

function commentText(post) {
  const template = (post.linkedin?.comment || "").trim() || DEFAULT_COMMENT;
  const link = articleUrl(post);
  if (template.includes("{link}")) return template.replaceAll("{link}", link);
  // Link escrito à mão no comentário: respeita; sem nenhum link, acrescenta o do artigo
  return /https?:\/\//.test(template) ? template : `${template}\n${link}`;
}

// URL pública do post no LinkedIn (para abrir e fixar o comentário)
function postUrl(postUrn) {
  return postUrn ? `https://www.linkedin.com/feed/update/${postUrn}/` : null;
}

// Comentário como membro: a rota versionada (/rest/socialActions) é só para
// parceiros aprovados (403 partnerApiSocialActions); com "Share on LinkedIn"
// vale a /v2, sem LinkedIn-Version. A /rest fica como segunda tentativa.
async function createComment(account, postUrn, text) {
  const path = `/socialActions/${encodeURIComponent(postUrn)}/comments`;
  const body = { actor: account.personUrn, object: postUrn, message: { text } };

  const res = await fetch(`${API}/v2${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.ok) {
    const created = await res.json().catch(() => ({}));
    return res.headers.get("x-restli-id") || created.$URN || created.id || "created";
  }
  const v2Error = `v2 ${res.status}: ${(await res.text().catch(() => "")).slice(0, 150)}`;

  try {
    const rest = await linkedinFetch(account, `/rest${path}`, { method: "POST", body });
    return rest.headers.get("x-restli-id") || "created";
  } catch (err) {
    throw new Error(`Comentário recusado (${v2Error}; ${err.message})`.slice(0, 300));
  }
}

/**
 * Publica o post do artigo no LinkedIn. Idempotente: só um processo "pega"
 * o post (idle/failed → posting); se o post já existe e só faltou o
 * comentário, tenta apenas o comentário.
 */
async function shareArticle(postId) {
  const claimed = await BlogPost.findOneAndUpdate(
    {
      _id: postId,
      published: true,
      deletedAt: null,
      "linkedin.enabled": true,
      "linkedin.status": { $in: ["idle", "failed", null] },
    },
    { $set: { "linkedin.status": "posting", "linkedin.error": "", "linkedin.attemptedAt": new Date() } },
    { new: true, timestamps: false }
  );
  if (!claimed) return null;

  const li = claimed.linkedin;
  const save = (fields) =>
    BlogPost.updateOne({ _id: postId }, { $set: fields }, { timestamps: false });

  try {
    if (!li.text?.trim()) throw new Error("Texto do LinkedIn vazio");
    const account = await getActiveAccount();

    let postUrn = li.postUrn;
    if (!postUrn) {
      const imageUrl = li.imageUrl || claimed.coverImage;
      const imageUrn = imageUrl ? await uploadImage(account, imageUrl) : null;

      const res = await linkedinFetch(account, "/rest/posts", {
        method: "POST",
        body: {
          author: account.personUrn,
          commentary: toLittleText(li.text.trim()),
          visibility: "PUBLIC",
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          ...(imageUrn && { content: { media: { id: imageUrn, altText: claimed.title } } }),
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        },
      });
      postUrn = res.headers.get("x-restli-id");
      // Grava já: se o comentário falhar, a nova tentativa não duplica o post
      await save({ "linkedin.postUrn": postUrn, "linkedin.postedAt": new Date() });
    }

    const commentUrn = await createComment(account, postUrn, commentText(claimed));
    await save({ "linkedin.status": "posted", "linkedin.commentUrn": commentUrn });
    return { postUrn, commentUrn, url: postUrl(postUrn) };
  } catch (err) {
    await save({ "linkedin.status": "failed", "linkedin.error": err.message.slice(0, 300) });
    throw err;
  }
}

// "posting" parado há mais de 5 min = processo interrompido (timeout da função)
const STUCK_MS = 5 * 60 * 1000;

/** Nova tentativa pelo painel. Post sem postUrn e preso em "posting" pode já
 *  ter saído no LinkedIn; por isso só libera com force (o usuário conferiu). */
async function retryShare(postId, { force = false } = {}) {
  const post = await BlogPost.findById(postId).select("linkedin published");
  if (!post) throw Object.assign(new Error("Post não encontrado"), { status: 404 });
  if (!post.published) throw Object.assign(new Error("Publique o artigo antes"), { status: 422 });
  if (!post.linkedin?.enabled) throw Object.assign(new Error("LinkedIn desligado neste post"), { status: 422 });

  const { status, postUrn } = post.linkedin;
  if (status === "posted") throw Object.assign(new Error("Já publicado no LinkedIn"), { status: 409 });
  if (status === "posting") {
    const stuck = Date.now() - (post.linkedin.attemptedAt?.getTime() || 0) > STUCK_MS;
    if (!stuck) throw Object.assign(new Error("Publicação em andamento"), { status: 409 });
    if (!postUrn && !force) {
      throw Object.assign(
        new Error("A última tentativa foi interrompida. Confira no LinkedIn se o post saiu antes de tentar de novo."),
        { status: 409, needsConfirm: true }
      );
    }
    await BlogPost.updateOne({ _id: postId }, { $set: { "linkedin.status": "failed" } }, { timestamps: false });
  }

  return shareArticle(postId);
}

// Falha no LinkedIn não pode impedir a publicação nem o email
async function safeShareArticle(post) {
  if (!post?.linkedin?.enabled) return;
  try {
    await shareArticle(post._id);
  } catch (err) {
    console.error("[LINKEDIN]", err.message);
  }
}

module.exports = {
  isConfigured,
  authorizationUrl,
  verifyState,
  connectWithCode,
  getStatus,
  disconnect,
  shareArticle,
  safeShareArticle,
  retryShare,
  postUrl,
  commentText,
  toLittleText,
};
