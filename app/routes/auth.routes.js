const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
const User = require("../models/user.model");
const auth = require("../middlewares/auth.middleware");
const { requireAllowedOrigin } = require("../middlewares/auth.middleware");
const {
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  setPendingCookie,
  clearPendingCookie,
  readPending,
  readCookie,
  baseOptions,
} = require("../utils/session");
const { generateSecret, verifyTotp, otpauthUrl } = require("../utils/totp");
const { seal, openSecret } = require("../utils/secretBox");
const google = require("../services/google-auth.service");
const connectDB = require("../config/db.config");
const transporter = require("../config/mailer");
const resetPasswordEmail = require("../templates/resetPassword.email");
const { str } = require("../utils/sanitize");
const { FRONTEND_URL } = require("../config/urls");
const limiter = require("../services/ratelimit.service");
const jwt = require("jsonwebtoken");

/**
 * Login do painel em duas etapas:
 *   1. Google (principal) ou email + senha (reserva)
 *   2. código do app autenticador (TOTP) ou um código de recuperação
 * Nenhum caminho entra sem a etapa 2. No primeiro acesso, a etapa 2 é o
 * cadastro do app (QR code) — depois disso não dá para recadastrar pelo site.
 */

// Força bruta: 10 erros de login por IP a cada 15 min; 5 pedidos de nova senha por hora;
// 5 códigos errados do 2º fator a cada 15 min
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MIN = 15;
const FORGOT_MAX = 5;
const FORGOT_WINDOW_MIN = 60;
const MFA_MAX = 5;
const MFA_WINDOW_MIN = 15;
const RECOVERY_CODES = 10;
const ISSUER = "marck0101 Blog";

const router = express.Router();

const GOOGLE_NONCE_COOKIE = "google_oauth_nonce";
const GOOGLE_NONCE_OPTIONS = () => baseOptions("/api/auth/google");

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role });
const isEnrolled = (u) => Boolean(u?.mfa?.enabledAt);
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

// "ab12-cd34" → "ab12cd34" (o usuário pode digitar com ou sem traço/maiúsculas)
const normalizeRecovery = (code) => String(code || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function newRecoveryCodes() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // sem 0/o/1/l/i
  const codes = Array.from({ length: RECOVERY_CODES }, () => {
    const bytes = crypto.randomBytes(8);
    const raw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
  return { codes, hashes: codes.map((c) => sha256(normalizeRecovery(c))) };
}

const loginRedirect = (res, query) => res.redirect(`${FRONTEND_URL}/admin/login?${new URLSearchParams(query)}`);

// Usuário da etapa 1 (cookie admin_pending), ainda válido; null se não houver
async function pendingUser(req, fields = "") {
  const pending = readPending(req);
  if (!pending) return null;
  const user = await User.findById(pending.id).select(`name email role active sessionVersion mfa.enabledAt ${fields}`);
  if (!user || !user.active || user.role !== "admin" || (user.sessionVersion || 0) !== pending.v) return null;
  return { user, method: pending.method };
}

class SecretUnreadable extends Error {}

/**
 * Segredo do app (mfa.secret ou mfa.pendingSecret) já aberto. Se estava na
 * chave antiga, regrava com a atual. Se nenhuma chave abre (MFA_SECRET_KEY ou
 * JWT_SECRET trocados), lança SecretUnreadable.
 */
async function userSecret(user, field) {
  let opened;
  try {
    opened = openSecret(user.mfa[field]);
  } catch (err) {
    console.error(`[AUTH] Não foi possível abrir mfa.${field} de ${user.email}:`, err.message);
    throw new SecretUnreadable();
  }
  if (opened.resealed) {
    await User.updateOne({ _id: user._id }, { $set: { [`mfa.${field}`]: opened.resealed } });
    console.log(`[AUTH] mfa.${field} de ${user.email} regravado com a MFA_SECRET_KEY`);
  }
  return opened.plain;
}

// Chave trocada: nenhum código vai servir; o caminho é refazer o cadastro
function secretUnreadable(res) {
  return res.status(500).json({
    message:
      "O servidor não consegue ler o app autenticador cadastrado (a chave MFA_SECRET_KEY/JWT_SECRET mudou). " +
      "Use um código de recuperação ou rode scripts/reset-2fa.js.",
  });
}

function finishLogin(res, user) {
  clearPendingCookie(res);
  setSessionCookie(res, user);
}

// Só para testes locais: pula a etapa 2. Exige as três condições, para que
// nenhum erro de configuração desligue o 2FA em produção (na Vercel, VERCEL=1).
const skip2fa = () =>
  process.env.NODE_ENV === "development" && process.env.SKIP_2FA === "true" && !process.env.VERCEL;

if (skip2fa()) console.warn("[AUTH] SKIP_2FA ativo: login sem 2º fator (apenas desenvolvimento)");

/* ================= ETAPA 1: SENHA (RESERVA) ================= */

router.post("/login", requireAllowedOrigin, async (req, res) => {
  try {
    await connectDB();

    // Só string: {"$ne": null} viraria operador do MongoDB
    const email = str(req.body?.email).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!email || !password) {
      return res.status(400).json({ message: "Dados inválidos" });
    }

    const wait = await limiter.blockedFor("login", req, LOGIN_MAX);
    if (wait) return limiter.tooMany(res, wait);

    const user = await User.findOne({ email });
    const passwordMatch =
      user && user.active && user.role === "admin" && (await bcrypt.compare(password, user.password));

    if (!passwordMatch) {
      await limiter.hit("login", req, LOGIN_WINDOW_MIN);
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    await limiter.reset("login", req);

    if (skip2fa()) {
      finishLogin(res, user);
      return res.json({ next: "done", user: publicUser(user) });
    }

    // Senha certa ainda não entra: falta o 2º fator
    setPendingCookie(res, user, "password");
    return res.json({ next: isEnrolled(user) ? "verify" : "setup" });
  } catch (err) {
    console.error("ERRO LOGIN:", err);
    return res.status(500).json({ message: "Erro interno" });
  }
});

/* ================= ETAPA 1: GOOGLE ================= */

router.get("/google/start", (req, res) => {
  if (!google.isConfigured()) return loginRedirect(res, { error: "google-config" });
  const { url, nonce } = google.authorizationUrl();
  res.cookie(GOOGLE_NONCE_COOKIE, nonce, { ...GOOGLE_NONCE_OPTIONS(), maxAge: 10 * 60 * 1000 });
  res.redirect(url);
});

// O Google redireciona o navegador para cá
router.get("/google/callback", async (req, res) => {
  const cookieNonce = readCookie(req, GOOGLE_NONCE_COOKIE);
  res.clearCookie(GOOGLE_NONCE_COOKIE, GOOGLE_NONCE_OPTIONS());

  if (req.query.error) return loginRedirect(res, { error: "google-denied" });

  try {
    const nonce = google.verifyState(str(req.query.state), cookieNonce);
    const profile = await google.exchangeCode(str(req.query.code), nonce);

    await connectDB();
    const user = await User.findOne({ email: profile.email }).select("+googleSub");
    if (!user || !user.active || user.role !== "admin") {
      console.warn("[AUTH] Google: conta sem acesso ao painel:", profile.email);
      return loginRedirect(res, { error: "google-account" });
    }

    // Primeiro login com Google vincula a conta; depois, só a mesma conta entra
    if (user.googleSub && user.googleSub !== profile.sub) {
      console.warn("[AUTH] Google: sub diferente do vinculado para", profile.email);
      return loginRedirect(res, { error: "google-account" });
    }
    if (!user.googleSub) {
      await User.updateOne({ _id: user._id }, { $set: { googleSub: profile.sub } });
    }

    if (skip2fa()) {
      finishLogin(res, user);
      return res.redirect(`${FRONTEND_URL}/admin`);
    }

    setPendingCookie(res, user, "google");
    return loginRedirect(res, { step: isEnrolled(user) ? "verify" : "setup" });
  } catch (err) {
    console.error("[AUTH] Google callback:", err.message);
    return loginRedirect(res, { error: "google-failed" });
  }
});

/* ================= ETAPA 2: APP AUTENTICADOR ================= */

// Situação da etapa 2 (a tela de login usa para saber o que mostrar)
router.get("/2fa/pending", async (req, res, next) => {
  try {
    await connectDB();
    const pending = await pendingUser(req);
    if (!pending) return res.status(401).json({ message: "Entre novamente" });
    res.set("Cache-Control", "no-store");
    res.json({ method: pending.method, email: pending.user.email, enrolled: isEnrolled(pending.user) });
  } catch (err) {
    next(err);
  }
});

// Primeiro acesso: gera o segredo e o QR code (ainda não ativa nada)
router.post("/2fa/setup", requireAllowedOrigin, async (req, res, next) => {
  try {
    await connectDB();
    const pending = await pendingUser(req);
    if (!pending) return res.status(401).json({ message: "Entre novamente" });
    if (isEnrolled(pending.user)) {
      return res.status(409).json({ message: "O app autenticador já está configurado" });
    }

    const secret = generateSecret();
    await User.updateOne({ _id: pending.user._id }, { $set: { "mfa.pendingSecret": seal(secret) } });

    const url = otpauthUrl(secret, pending.user.email, ISSUER);
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
    res.set("Cache-Control", "no-store");
    res.json({ qr, secret: secret.match(/.{1,4}/g).join(" ") });
  } catch (err) {
    next(err);
  }
});

// Confirma o cadastro com o primeiro código do app; devolve os códigos de recuperação
router.post("/2fa/enable", requireAllowedOrigin, async (req, res, next) => {
  try {
    await connectDB();
    const wait = await limiter.blockedFor("mfa", req, MFA_MAX);
    if (wait) return limiter.tooMany(res, wait);

    const pending = await pendingUser(req, "+mfa.pendingSecret");
    if (!pending) return res.status(401).json({ message: "Entre novamente" });
    const { user } = pending;
    if (isEnrolled(user)) return res.status(409).json({ message: "O app autenticador já está configurado" });
    if (!user.mfa?.pendingSecret) return res.status(400).json({ message: "Gere o QR code primeiro" });

    const step = verifyTotp(await userSecret(user, "pendingSecret"), req.body?.code);
    if (step === null) {
      await limiter.hit("mfa", req, MFA_WINDOW_MIN);
      return res.status(401).json({ message: "Código incorreto. Confira o horário do celular e tente o código atual." });
    }

    const { codes, hashes } = newRecoveryCodes();
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          "mfa.secret": user.mfa.pendingSecret,
          "mfa.enabledAt": new Date(),
          "mfa.lastStep": step,
          "mfa.recoveryCodes": hashes,
        },
        $unset: { "mfa.pendingSecret": "" },
      }
    );
    await limiter.reset("mfa", req);

    finishLogin(res, user);
    res.set("Cache-Control", "no-store");
    return res.json({ user: publicUser(user), recoveryCodes: codes });
  } catch (err) {
    if (err instanceof SecretUnreadable) return secretUnreadable(res);
    next(err);
  }
});

// Login normal: código do app ou um código de recuperação
router.post("/2fa/verify", requireAllowedOrigin, async (req, res, next) => {
  try {
    await connectDB();
    const wait = await limiter.blockedFor("mfa", req, MFA_MAX);
    if (wait) return limiter.tooMany(res, wait);

    const pending = await pendingUser(req, "+mfa.secret +mfa.lastStep +mfa.recoveryCodes");
    if (!pending) return res.status(401).json({ message: "Entre novamente" });
    const { user } = pending;
    if (!isEnrolled(user)) return res.status(409).json({ message: "Configure o app autenticador primeiro" });

    const code = String(req.body?.code || "").trim();
    let accepted = false;
    let usedRecovery = false;

    if (/^\d{6}$/.test(code.replace(/\s/g, ""))) {
      const step = verifyTotp(await userSecret(user, "secret"), code, user.mfa.lastStep ?? -1);
      // Grava o passo só se ninguém usou um igual ou mais novo no meio tempo
      if (step !== null) {
        const r = await User.updateOne(
          { _id: user._id, "mfa.lastStep": { $lt: step } },
          { $set: { "mfa.lastStep": step } }
        );
        accepted = r.modifiedCount === 1;
      }
    } else {
      const hash = sha256(normalizeRecovery(code));
      // Cada código de recuperação vale uma vez
      const r = await User.updateOne(
        { _id: user._id, "mfa.recoveryCodes": hash },
        { $pull: { "mfa.recoveryCodes": hash } }
      );
      accepted = r.modifiedCount === 1;
      usedRecovery = accepted;
    }

    if (!accepted) {
      await limiter.hit("mfa", req, MFA_WINDOW_MIN);
      return res.status(401).json({ message: "Código incorreto" });
    }

    await limiter.reset("mfa", req);
    finishLogin(res, user);
    const left = usedRecovery ? user.mfa.recoveryCodes.length - 1 : undefined;
    return res.json({ user: publicUser(user), recoveryCodesLeft: left });
  } catch (err) {
    if (err instanceof SecretUnreadable) return secretUnreadable(res);
    next(err);
  }
});

/* ================= SESSÃO ================= */

// Sessão atual (o painel confere ao abrir; 401 = precisa entrar)
router.get("/me", auth, async (req, res, next) => {
  try {
    const full = await User.findById(req.userId).select("+mfa.recoveryCodes +googleSub").lean();
    res.set("Cache-Control", "no-store");
    res.json({
      user: publicUser(req.user),
      security: {
        mfaEnabledAt: full?.mfa?.enabledAt || null,
        recoveryCodesLeft: full?.mfa?.recoveryCodes?.length ?? 0,
        googleLinked: Boolean(full?.googleSub),
        googleConfigured: google.isConfigured(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Novos códigos de recuperação (os antigos deixam de valer). Pede o código do app.
router.post("/2fa/recovery-codes", auth, async (req, res, next) => {
  try {
    const wait = await limiter.blockedFor("mfa", req, MFA_MAX);
    if (wait) return limiter.tooMany(res, wait);

    const user = await User.findById(req.userId).select("+mfa.secret +mfa.lastStep");
    const step = user?.mfa?.secret
      ? verifyTotp(await userSecret(user, "secret"), req.body?.code, user.mfa.lastStep ?? -1)
      : null;
    if (step === null) {
      await limiter.hit("mfa", req, MFA_WINDOW_MIN);
      return res.status(401).json({ message: "Código incorreto" });
    }

    const { codes, hashes } = newRecoveryCodes();
    await User.updateOne({ _id: user._id }, { $set: { "mfa.lastStep": step, "mfa.recoveryCodes": hashes } });
    await limiter.reset("mfa", req);
    res.set("Cache-Control", "no-store");
    res.json({ recoveryCodes: codes });
  } catch (err) {
    if (err instanceof SecretUnreadable) return secretUnreadable(res);
    next(err);
  }
});

// Sair: encerra a sessão em todos os aparelhos (sobe a versão da sessão).
// Cookie inválido/expirado também sai.
router.post("/logout", requireAllowedOrigin, async (req, res) => {
  const token = readSessionCookie(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
      await connectDB();
      await User.updateOne({ _id: decoded.id, sessionVersion: decoded.v }, { $inc: { sessionVersion: 1 } });
    } catch {
      /* sessão já inválida: só apaga os cookies */
    }
  }
  clearSessionCookie(res);
  clearPendingCookie(res);
  res.status(204).end();
});

/* ================= SENHA ================= */

router.post("/forgot-password", async (req, res) => {
  try {
    await connectDB();

    const email = str(req.body?.email).toLowerCase();
    if (!email) {
      return res.status(400).json({ message: "Email é obrigatório" });
    }

    // Cada pedido conta (evita usar a rota para disparar emails em massa)
    const wait = await limiter.blockedFor("forgot", req, FORGOT_MAX);
    if (wait) return limiter.tooMany(res, wait);
    await limiter.hit("forgot", req, FORGOT_WINDOW_MIN);

    const user = await User.findOne({ email });

    // Resposta genérica sempre, para não revelar se o email existe ou não
    if (!user || !user.active) {
      return res.json({
        message: "Se o email existir, um link de redefinição foi enviado",
      });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hora
    await user.save();

    const resetUrl = `${FRONTEND_URL}/admin/reset-password?token=${rawToken}`;

    await transporter.sendMail({
      from: `"marck0101" <${process.env.GMAIL_USER}>`,
      to: user.email,
      subject: "Redefinição de senha | marck0101",
      html: resetPasswordEmail({ userName: user.name, resetUrl }),
    });

    return res.json({
      message: "Se o email existir, um link de redefinição foi enviado",
    });
  } catch (err) {
    console.error("ERRO FORGOT PASSWORD:", err);
    return res.status(500).json({ message: "Erro interno" });
  }
});

// Redefinir a senha não pula o 2º fator (o próximo login ainda pede o código)
// e derruba as sessões abertas.
router.post("/reset-password", async (req, res) => {
  try {
    await connectDB();

    const token = str(req.body?.token);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!token || !password) {
      return res.status(400).json({ message: "Dados inválidos" });
    }

    if (password.length < 8) {
      return res
        .status(400)
        .json({ message: "A senha deve ter no mínimo 8 caracteres" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    }).select("+resetPasswordToken +resetPasswordExpires");

    if (!user) {
      return res.status(400).json({ message: "Token inválido ou expirado" });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    await user.save();

    return res.json({ message: "Senha redefinida com sucesso" });
  } catch (err) {
    console.error("ERRO RESET PASSWORD:", err);
    return res.status(500).json({ message: "Erro interno" });
  }
});

module.exports = router;
