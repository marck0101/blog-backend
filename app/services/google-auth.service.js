const crypto = require("crypto");
const jwt = require("jsonwebtoken");

/**
 * Login com Google (OpenID Connect, fluxo "authorization code" no servidor).
 * Só a etapa 1 do login: depois ainda vem o código do app autenticador.
 *
 * Variáveis: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
 * (ex.: https://api.blog.marck0101.com.br/api/auth/google/callback).
 */
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * URL de autorização + nonce. O nonce vai num cookie do navegador e dentro do
 * state assinado: o callback só aceita a volta no mesmo navegador que começou
 * (impede alguém de "logar você" na conta dele) e o id_token precisa trazer o
 * mesmo nonce.
 */
// Login de leitor (comentários): mesmo app do Google, outra URL de retorno.
// GOOGLE_READER_REDIRECT_URI é opcional: o padrão troca só o caminho da do admin.
function readerRedirectUri() {
  if (process.env.GOOGLE_READER_REDIRECT_URI) return process.env.GOOGLE_READER_REDIRECT_URI;
  return new URL("/api/comments/google/callback", process.env.GOOGLE_REDIRECT_URI).toString();
}

// Opções padrão = login do painel. O leitor passa purpose "reader-login", a
// própria redirectUri e `extra` (ex.: para onde voltar), que vai assinado no state.
function authorizationUrl({ purpose = "google-login", redirectUri = process.env.GOOGLE_REDIRECT_URI, extra = {} } = {}) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = jwt.sign({ ...extra, purpose, nonce }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "10m",
  });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
  });
  return { url: `${AUTH_URL}?${params}`, nonce };
}

// Devolve o payload do state (nonce + extra)
function verifyStatePayload(state, cookieNonce, purpose = "google-login") {
  const payload = jwt.verify(state, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  if (payload.purpose !== purpose) throw new Error("state inválido");
  if (!cookieNonce || payload.nonce !== cookieNonce) throw new Error("Login iniciado em outro navegador ou expirado");
  return payload;
}

function verifyState(state, cookieNonce) {
  return verifyStatePayload(state, cookieNonce).nonce;
}

function decodeJwtPayload(token) {
  const part = String(token || "").split(".")[1];
  if (!part) throw new Error("id_token ausente");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/**
 * Troca o code pelo id_token e devolve { sub, email, name }.
 * O id_token vem direto do endpoint de token do Google, por HTTPS e com o
 * client secret — o OpenID Connect permite validar emissor pelo TLS nesse caso
 * (sem baixar as chaves públicas). Público, emissor, validade, nonce e email
 * verificado são conferidos aqui.
 */
async function exchangeCode(code, expectedNonce, redirectUri = process.env.GOOGLE_REDIRECT_URI) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: String(code || ""),
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) {
    throw new Error(data.error_description || data.error || "Google recusou o login");
  }

  const claims = decodeJwtPayload(data.id_token);
  if (!ISSUERS.includes(claims.iss)) throw new Error("Emissor inválido");
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error("Token de outro aplicativo");
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error("Token do Google expirado");
  if (claims.nonce !== expectedNonce) throw new Error("nonce inválido");
  if (claims.email_verified !== true) throw new Error("Email do Google não verificado");

  return {
    sub: String(claims.sub),
    email: String(claims.email).toLowerCase(),
    name: claims.name || "",
    picture: claims.picture || "",
  };
}

module.exports = {
  isConfigured,
  authorizationUrl,
  verifyState,
  verifyStatePayload,
  exchangeCode,
  readerRedirectUri,
};
