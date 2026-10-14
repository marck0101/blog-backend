const jwt = require("jsonwebtoken");

// Sessão do admin em cookie httpOnly: o JavaScript da página não lê o token,
// então um XSS não consegue roubá-lo.
//
// SameSite=Lax funciona porque o painel e a API são o mesmo site:
//   prod: blog.marck0101.com.br → api.blog.marck0101.com.br
//   dev:  localhost:5173 → localhost:3333
//
// Login em duas etapas:
//   1. Google (ou senha, reserva) → cookie "admin_pending" (10 min, só serve
//      para as rotas /api/auth/2fa/*)
//   2. código do app autenticador → cookie "admin_session" (7 dias)
const SESSION_COOKIE = "admin_session";
const PENDING_COOKIE = "admin_pending";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

const isProd = () => process.env.NODE_ENV === "production";

function baseOptions(path) {
  return { httpOnly: true, secure: isProd(), sameSite: "lax", path };
}

const SESSION_OPTIONS = () => baseOptions("/api");
const PENDING_OPTIONS = () => baseOptions("/api/auth");

function sign(payload, expiresIn) {
  return jwt.sign(payload, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn });
}

// mfa: true = passou pelo 2º fator; v = versão da sessão do usuário
function setSessionCookie(res, user) {
  const token = sign(
    { id: user._id, role: user.role, mfa: true, v: user.sessionVersion || 0 },
    "7d"
  );
  res.cookie(SESSION_COOKIE, token, { ...SESSION_OPTIONS(), maxAge: SESSION_MAX_AGE_MS });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, SESSION_OPTIONS());
}

// method: "google" | "password" — só para exibir e registrar
function setPendingCookie(res, user, method) {
  const token = sign({ id: user._id, stage: "mfa", method, v: user.sessionVersion || 0 }, "10m");
  res.cookie(PENDING_COOKIE, token, { ...PENDING_OPTIONS(), maxAge: PENDING_MAX_AGE_MS });
}

function clearPendingCookie(res) {
  res.clearCookie(PENDING_COOKIE, PENDING_OPTIONS());
}

// Lê um cookie sem depender do cookie-parser
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

const readSessionCookie = (req) => readCookie(req, SESSION_COOKIE);

// Etapa 1 concluída e ainda no prazo? Devolve { id, method, v } ou null
function readPending(req) {
  const token = readCookie(req, PENDING_COOKIE);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    return payload.stage === "mfa" ? payload : null;
  } catch {
    return null;
  }
}

module.exports = {
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  setPendingCookie,
  clearPendingCookie,
  readPending,
  readCookie,
  sign,
  baseOptions,
};
