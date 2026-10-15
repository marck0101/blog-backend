const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middlewares/auth.middleware");
const { requireAllowedOrigin } = require("../middlewares/auth.middleware");
const connectDB = require("../config/db.config");
const Comment = require("../models/comment.model");
const BlogPost = require("../models/blogpost.model");
const google = require("../services/google-auth.service");
const limiter = require("../services/ratelimit.service");
const transporter = require("../config/mailer");
const escapeHtml = require("../utils/escapeHtml");
const { str } = require("../utils/sanitize");
const { FRONTEND_URL } = require("../config/urls");
const { setReaderCookie, clearReaderCookie, readReader, readCookie, baseOptions } = require("../utils/session");

/**
 * Comentários dos posts.
 *   Leitor: entra com Google (mesmo fluxo do login do painel, outra URL de
 *   retorno), comenta, o comentário fica pendente até a aprovação no painel.
 *   Painel: aprova, recusa, responde como autor e exclui.
 */
const router = express.Router();

const BODY_MIN = 2;
const BODY_MAX = 2000;
// 5 comentários a cada 10 min por IP; no máximo 5 pendentes por pessoa
const COMMENT_MAX = 5;
const COMMENT_WINDOW_MIN = 10;
const PENDING_PER_READER = 5;

const NONCE_COOKIE = "reader_oauth_nonce";
const NONCE_OPTIONS = () => baseOptions("/api/comments/google");

// Só volta para uma página do próprio blog (nada de redirecionar para outro site)
function safeReturnPath(value) {
  const path = str(value);
  return /^\/blog\/[a-z0-9-]+$/i.test(path) ? path : "/blog";
}

// Texto puro: sem caracteres de controle e no máximo uma linha em branco seguida
function cleanBody(value) {
  return str(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function validBody(body) {
  if (body.length < BODY_MIN) return "Escreva um comentário";
  if (body.length > BODY_MAX) return `O comentário pode ter até ${BODY_MAX} caracteres`;
  return null;
}

// Total de aprovados no post (aparece no card e no painel)
async function syncCount(postId) {
  const count = await Comment.countDocuments({ post: postId, status: "approved" });
  await BlogPost.updateOne({ _id: postId }, { $set: { commentsCount: count } }, { timestamps: false });
}

// O que o leitor vê de um comentário: nunca email nem id da conta Google
function publicComment(c, reader) {
  return {
    id: c._id,
    parent: c.parent,
    name: c.author?.name || "Leitor",
    picture: c.author?.picture || "",
    isAuthor: Boolean(c.isAuthor),
    body: c.body,
    status: c.status,
    createdAt: c.createdAt,
    mine: Boolean(reader && c.author?.sub && c.author.sub === reader.sub),
  };
}

const publicReader = (r) => (r ? { name: r.name, picture: r.picture } : null);

async function publishedPost(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return BlogPost.findOne({ _id: id, published: true, deletedAt: null }).select("_id title slug").lean();
}

// Aviso para o autor: há comentário esperando aprovação. Falha no email não
// impede o comentário.
async function notifyAuthor(comment, post) {
  const to = process.env.ADMIN_EMAIL || process.env.GMAIL_USER;
  if (!to || !process.env.GMAIL_USER) return;
  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject: `Novo comentário em "${post.title}"`,
      html: `<p><strong>${escapeHtml(comment.author.name)}</strong> (${escapeHtml(comment.author.email)}) comentou:</p>
<blockquote style="border-left:3px solid #ddd;margin:0;padding:0 12px;white-space:pre-line">${escapeHtml(comment.body)}</blockquote>
<p><a href="${FRONTEND_URL}/admin/comments">Aprovar ou recusar no painel</a></p>`,
    });
  } catch (err) {
    console.error("[COMMENTS] aviso por email:", err.message);
  }
}

/* ================= LEITOR: LOGIN ================= */

// Login de leitor disponível? (o front mostra ou esconde o botão)
router.get("/me", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ enabled: google.isConfigured(), reader: publicReader(readReader(req)) });
});

// ?return=/blog/slug → Google → callback → volta para o post
router.get("/google/start", (req, res) => {
  const returnTo = safeReturnPath(req.query.return);
  if (!google.isConfigured()) return res.redirect(`${FRONTEND_URL}${returnTo}?login=erro#comentarios`);
  const { url, nonce } = google.authorizationUrl({
    purpose: "reader-login",
    redirectUri: google.readerRedirectUri(),
    extra: { returnTo },
  });
  res.cookie(NONCE_COOKIE, nonce, { ...NONCE_OPTIONS(), maxAge: 10 * 60 * 1000 });
  res.redirect(url);
});

router.get("/google/callback", async (req, res) => {
  const cookieNonce = readCookie(req, NONCE_COOKIE);
  res.clearCookie(NONCE_COOKIE, NONCE_OPTIONS());

  let returnTo = "/blog";
  try {
    const state = google.verifyStatePayload(str(req.query.state), cookieNonce, "reader-login");
    returnTo = safeReturnPath(state.returnTo);
    if (req.query.error) return res.redirect(`${FRONTEND_URL}${returnTo}#comentarios`);

    const profile = await google.exchangeCode(str(req.query.code), state.nonce, google.readerRedirectUri());
    setReaderCookie(res, profile);
    return res.redirect(`${FRONTEND_URL}${returnTo}#comentarios`);
  } catch (err) {
    console.error("[COMMENTS] Google callback:", err.message);
    return res.redirect(`${FRONTEND_URL}${returnTo}?login=erro#comentarios`);
  }
});

router.delete("/session", requireAllowedOrigin, (req, res) => {
  clearReaderCookie(res);
  res.json({ ok: true });
});

/* ================= LEITOR: COMENTÁRIOS ================= */

// Aprovados do post + os pendentes da própria pessoa ("aguardando aprovação")
router.get("/post/:postId", async (req, res, next) => {
  try {
    await connectDB();
    res.set("Cache-Control", "no-store");
    const post = await publishedPost(req.params.postId);
    if (!post) return res.status(404).json({ error: "Post não encontrado" });

    const reader = readReader(req);
    const or = [{ status: "approved" }];
    if (reader) or.push({ status: "pending", "author.sub": reader.sub });

    const comments = await Comment.find({ post: post._id, $or: or }).sort({ createdAt: 1 }).limit(500).lean();
    res.json({ comments: comments.map((c) => publicComment(c, reader)) });
  } catch (err) {
    next(err);
  }
});

router.post("/post/:postId", requireAllowedOrigin, async (req, res, next) => {
  try {
    const reader = readReader(req);
    if (!reader) return res.status(401).json({ error: "Entre com sua conta Google para comentar" });

    await connectDB();
    const wait = await limiter.blockedFor("comment", req, COMMENT_MAX);
    if (wait) return limiter.tooMany(res, wait);

    const post = await publishedPost(req.params.postId);
    if (!post) return res.status(404).json({ error: "Post não encontrado" });

    const body = cleanBody(req.body?.body);
    const invalid = validBody(body);
    if (invalid) return res.status(422).json({ error: invalid });

    // Resposta: sempre presa ao comentário principal, aprovado, do mesmo post
    let parent = null;
    if (req.body?.parentId) {
      if (!mongoose.isValidObjectId(req.body.parentId)) return res.status(422).json({ error: "Comentário inválido" });
      const target = await Comment.findOne({ _id: req.body.parentId, post: post._id, status: "approved" }).lean();
      if (!target) return res.status(422).json({ error: "Comentário respondido não existe mais" });
      parent = target.parent || target._id;
    }

    const pending = await Comment.countDocuments({ "author.sub": reader.sub, status: "pending" });
    if (pending >= PENDING_PER_READER) {
      return res.status(429).json({ error: "Você já tem comentários aguardando aprovação. Aguarde antes de enviar outros." });
    }

    await limiter.hit("comment", req, COMMENT_WINDOW_MIN);
    const comment = await Comment.create({
      post: post._id,
      parent,
      author: { sub: reader.sub, name: reader.name, email: reader.email, picture: reader.picture },
      body,
    });
    await notifyAuthor(comment, post);

    res.status(201).json(publicComment(comment.toObject(), reader));
  } catch (err) {
    next(err);
  }
});

// A pessoa apaga o próprio comentário (e as respostas que ele recebeu)
router.delete("/mine/:id", requireAllowedOrigin, async (req, res, next) => {
  try {
    const reader = readReader(req);
    if (!reader) return res.status(401).json({ error: "Sessão expirada" });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Comentário não encontrado" });

    await connectDB();
    const comment = await Comment.findOne({ _id: req.params.id, "author.sub": reader.sub }).lean();
    if (!comment) return res.status(404).json({ error: "Comentário não encontrado" });

    await Comment.deleteMany({ $or: [{ _id: comment._id }, { parent: comment._id }] });
    await syncCount(comment.post);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ================= PAINEL ================= */

const STATUSES = ["pending", "approved", "rejected"];

router.get("/admin/pending-count", auth, async (req, res, next) => {
  try {
    await connectDB();
    res.json({ count: await Comment.countDocuments({ status: "pending" }) });
  } catch (err) {
    next(err);
  }
});

// ?status=pending|approved|rejected&page=1&post=<id>
router.get("/admin", auth, async (req, res, next) => {
  try {
    await connectDB();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const filter = {};
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (mongoose.isValidObjectId(req.query.post)) filter.post = req.query.post;

    const [comments, total, counts] = await Promise.all([
      Comment.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("post", "title slug")
        .populate("parent", "author.name body")
        .lean(),
      Comment.countDocuments(filter),
      Comment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    res.json({
      comments,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      counts: Object.fromEntries(STATUSES.map((s) => [s, counts.find((c) => c._id === s)?.count || 0])),
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/admin/:id", auth, async (req, res, next) => {
  try {
    const status = req.body?.status;
    if (!STATUSES.includes(status)) return res.status(422).json({ error: "Status inválido" });

    await connectDB();
    const comment = await Comment.findByIdAndUpdate(
      req.params.id,
      { status, approvedAt: status === "approved" ? new Date() : null },
      { new: true }
    );
    if (!comment) return res.status(404).json({ error: "Comentário não encontrado" });

    await syncCount(comment.post);
    res.json(comment);
  } catch (err) {
    next(err);
  }
});

// Resposta do autor: aparece na hora (não passa por aprovação). Responder
// também aprova o comentário respondido, se ainda estava pendente.
router.post("/admin/:id/reply", auth, async (req, res, next) => {
  try {
    const body = cleanBody(req.body?.body);
    const invalid = validBody(body);
    if (invalid) return res.status(422).json({ error: invalid });

    await connectDB();
    const target = await Comment.findById(req.params.id);
    if (!target) return res.status(404).json({ error: "Comentário não encontrado" });

    if (target.status !== "approved") {
      target.status = "approved";
      target.approvedAt = new Date();
      await target.save();
    }

    const reply = await Comment.create({
      post: target.post,
      parent: target.parent || target._id,
      author: { name: req.user?.name || "Autor", email: req.user?.email || "" },
      isAuthor: true,
      body,
      status: "approved",
      approvedAt: new Date(),
    });

    await syncCount(target.post);
    res.status(201).json(reply);
  } catch (err) {
    next(err);
  }
});

router.delete("/admin/:id", auth, async (req, res, next) => {
  try {
    await connectDB();
    const comment = await Comment.findById(req.params.id).lean();
    if (!comment) return res.status(404).json({ error: "Comentário não encontrado" });

    await Comment.deleteMany({ $or: [{ _id: comment._id }, { parent: comment._id }] });
    await syncCount(comment.post);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
