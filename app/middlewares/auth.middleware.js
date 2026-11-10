const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const connectDB = require("../config/db.config");
const User = require("../models/user.model");
const ALLOWED_ORIGINS = require("../config/origins");
const { readSessionCookie } = require("../utils/session");

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

// CSRF: o navegador manda cookies sozinho, inclusive em formulários vindos de
// outros subdomínios *.marck0101.com.br (mesmo site para o SameSite). Ação que
// altera dados só vale vinda de uma origem do painel.
function originAllowed(req) {
  if (SAFE_METHODS.includes(req.method)) return true;
  const origin = req.headers.origin;
  return Boolean(origin && ALLOWED_ORIGINS.includes(origin));
}

// Para rotas com cookie que não passam pelo auth (etapas do login)
function requireAllowedOrigin(req, res, next) {
  if (!originAllowed(req)) return res.status(403).json({ message: "Origem não permitida" });
  next();
}

// Token da requisição: header Authorization (scripts/ferramentas) ou o cookie
// httpOnly da sessão do painel. Devolve { token, fromCookie } ou { error }.
function readToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const [scheme, token, extra] = authHeader.split(" ");
    if (extra !== undefined || !token || !/^Bearer$/i.test(scheme)) {
      return { error: "Token mal formatado" };
    }
    return { token, fromCookie: false };
  }
  const token = readSessionCookie(req);
  return token ? { token, fromCookie: true } : { error: "Token não informado" };
}

const INVALID = { message: "Sessão inválida ou expirada" };

// Painel admin: sessão válida, que passou pelo 2º fator, na versão atual do
// usuário (sair/trocar senha derruba as outras), e usuário ainda ativo e admin.
// Devolve { userId, user } ou { status, body } com o motivo da recusa.
// Erro de banco é lançado (vira 500 no tratador), nunca "sessão válida".
async function resolveSession(req) {
  const { token, fromCookie, error } = readToken(req);
  if (error) return { status: 401, body: { message: error } };

  if (fromCookie && !originAllowed(req)) {
    return { status: 403, body: { message: "Origem não permitida" } };
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    return { status: 401, body: INVALID };
  }

  // Sessão emitida antes do 2º fator (ou etapa intermediária do login) não vale
  if (decoded?.mfa !== true || !mongoose.isValidObjectId(decoded?.id)) {
    return { status: 401, body: INVALID };
  }

  await connectDB();
  const user = await User.findById(decoded.id).select("name email role active sessionVersion").lean();
  if (!user || !user.active || user.role !== "admin" || (user.sessionVersion || 0) !== decoded.v) {
    return { status: 401, body: INVALID };
  }
  return { userId: decoded.id, user };
}

async function auth(req, res, next) {
  try {
    const session = await resolveSession(req);
    if (!session.user) return res.status(session.status).json(session.body);
    req.userId = session.userId;
    req.user = session.user;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = auth;
module.exports.requireAllowedOrigin = requireAllowedOrigin;
module.exports.resolveSession = resolveSession;
