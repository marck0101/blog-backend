const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middlewares/auth.middleware");
const connectDB = require("../config/db.config");
const Suggestion = require("../models/suggestion.model");
const { STATUSES } = require("../models/suggestion.model");
const BlogPost = require("../models/blogpost.model");
const Subscriber = require("../models/subscriber.model");
const CATEGORIES = require("../config/categories");
const limiter = require("../services/ratelimit.service");
const { subscribeEmail } = require("../services/subscription.service");
const { readFeatures } = require("./settings.routes");
const { validate } = require("../validation/validate");
const { createBody, updateBody, adminListQuery } = require("../validation/suggestions.schemas");
const transporter = require("../config/mailer");
const escapeHtml = require("../utils/escapeHtml");
const { FRONTEND_URL } = require("../config/urls");

const router = express.Router();

// R-SUG-03: 3 sugestões por IP a cada hora. Barra script enchendo a caixinha
// (e cadastrando emails de terceiros pela caixa "quero assinar").
const CREATE_MAX = 3;
const CREATE_WINDOW_MIN = 60;
const PAGE_SIZE = 20;
const PUBLIC_MAX = 50;

// Mesma resposta para tudo que passou (inclusive robô pego na armadilha e email
// que já é assinante): a rota pública não revela quem é assinante.
const RECEIVED = { message: "Sugestão recebida. Obrigado!" };

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

// Aviso para o autor do blog: chegou sugestão. Falha no email não perde a sugestão.
async function notifyAdmin(suggestion) {
  const to = process.env.ADMIN_EMAIL || process.env.GMAIL_USER;
  if (!to || !process.env.GMAIL_USER) return;
  const category = CATEGORIES.find((c) => c.slug === suggestion.category)?.label || suggestion.category;
  const kind = { topic: "Tema para um post", participate: "Quer participar de um conteúdo", other: "Outro" }[suggestion.kind];
  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject: `Nova sugestão: ${kind} (${category})`,
      html: `<p><strong>${escapeHtml(suggestion.name || "Sem nome")}</strong> (${escapeHtml(suggestion.email)}) sugeriu:</p>
<blockquote style="border-left:3px solid #ddd;margin:0;padding:0 12px;white-space:pre-line">${escapeHtml(suggestion.message)}</blockquote>
<p><a href="${FRONTEND_URL}/admin/sugestoes">Ver no painel</a></p>`,
    });
  } catch (err) {
    console.error("[SUGGESTIONS] aviso por email:", err.message);
  }
}

// R-SUG-07: "sua sugestão virou post". Devolve true se o email saiu.
async function notifyReader(suggestion, post) {
  if (!process.env.GMAIL_USER || !suggestion.email) return false;
  const link = `${FRONTEND_URL}/blog/${encodeURIComponent(post.slug)}`;
  const hello = escapeHtml(firstName(suggestion.name) || "Olá");
  try {
    await transporter.sendMail({
      from: `"marck0101" <${process.env.GMAIL_USER}>`,
      to: suggestion.email,
      subject: `Sua sugestão virou post: ${post.title}`,
      html: `<p>${hello}, lembra da sugestão que você mandou para o blog?</p>
<blockquote style="border-left:3px solid #ddd;margin:0;padding:0 12px;white-space:pre-line">${escapeHtml(suggestion.message)}</blockquote>
<p>Ela virou o post <a href="${link}"><strong>${escapeHtml(post.title)}</strong></a>. Obrigado pela ideia.</p>
<p>Se tiver outra, a caixinha continua aberta: <a href="${FRONTEND_URL}/sugestoes">${FRONTEND_URL.replace(/^https?:\/\//, "")}/sugestoes</a>.</p>`,
    });
    return true;
  } catch (err) {
    console.error("[SUGGESTIONS] aviso de post:", err.message);
    return false;
  }
}

/* ================= PÚBLICO ================= */

router.post("/", validate({ body: createBody }), async (req, res, next) => {
  try {
    await connectDB();

    // R-SUG-01: caixinha desligada em Recursos do blog recusa o envio
    const features = await readFeatures();
    if (features.suggestions === false) {
      return res.status(403).json({ error: "A caixinha de sugestões está fechada no momento." });
    }

    const wait = await limiter.blockedFor("suggestion", req, CREATE_MAX);
    if (wait) return limiter.tooMany(res, wait);
    await limiter.hit("suggestion", req, CREATE_WINDOW_MIN);

    const { kind, category, message, name, email, allowName, subscribe, sourcePath, website } = req.body;

    // Armadilha preenchida: responde como sucesso e não guarda nada
    if (website) return res.status(201).json(RECEIVED);

    if (!CATEGORIES.SLUGS.includes(category)) return res.status(422).json({ error: "Escolha o assunto da sugestão" });

    // R-SUG-02: assinar é escolha da pessoa (caixa no formulário), nunca condição
    // para sugerir. Assina com todos os temas, como o formulário curto da newsletter.
    let subscriber = null;
    if (subscribe) {
      subscriber = await subscribeEmail({
        email,
        name,
        categories: CATEGORIES.SLUGS,
        source: { location: "suggestion", path: sourcePath || "/sugestoes" },
      });
    } else {
      subscriber = await Subscriber.findOne({ email, status: "active" }).select("_id").lean();
    }

    const suggestion = await Suggestion.create({
      kind,
      category,
      message,
      name: name || "",
      email,
      allowName: Boolean(allowName),
      subscribed: Boolean(subscribe),
      subscriber: subscriber?._id || null,
      sourcePath: sourcePath || "",
    });

    await notifyAdmin(suggestion);
    res.status(201).json(RECEIVED);
  } catch (err) {
    next(err);
  }
});

// R-SUG-05: vitrine "Vocês pediram, saiu". Só o texto público, o assunto, o post
// e o primeiro nome de quem autorizou. Email e texto original nunca saem.
router.get("/public", async (req, res, next) => {
  try {
    await connectDB();
    const list = await Suggestion.find({ isPublic: true, status: "done", post: { $ne: null } })
      .sort({ doneAt: -1, _id: -1 })
      .limit(PUBLIC_MAX)
      .populate({ path: "post", select: "title slug published deletedAt" })
      .lean();

    const suggestions = list
      .filter((s) => s.post?.published && !s.post.deletedAt && s.publicText)
      .map((s) => ({
        _id: s._id,
        kind: s.kind,
        category: s.category,
        text: s.publicText,
        by: s.allowName ? firstName(s.name) || null : null,
        doneAt: s.doneAt,
        post: { title: s.post.title, slug: s.post.slug },
      }));

    res.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
});

/* ================= PAINEL ================= */

router.get("/admin/new-count", auth, async (req, res, next) => {
  try {
    await connectDB();
    res.json({ count: await Suggestion.countDocuments({ status: "new" }) });
  } catch (err) {
    next(err);
  }
});

// ?status=new|planned|done|archived&page=1 (sem status: todas)
router.get("/admin", auth, validate({ query: adminListQuery }), async (req, res, next) => {
  try {
    await connectDB();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const filter = STATUSES.includes(req.query.status) ? { status: req.query.status } : {};

    const [suggestions, total, counts] = await Promise.all([
      Suggestion.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .populate("post", "title slug status published")
        .populate("subscriber", "status tier")
        .lean(),
      Suggestion.countDocuments(filter),
      Suggestion.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    res.json({
      suggestions,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      counts: Object.fromEntries(STATUSES.map((s) => [s, counts.find((c) => c._id === s)?.count || 0])),
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/admin/:id", auth, validate({ body: updateBody }), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Sugestão não encontrada" });
    await connectDB();
    const suggestion = await Suggestion.findById(req.params.id);
    if (!suggestion) return res.status(404).json({ error: "Sugestão não encontrada" });

    const { status, post, isPublic, publicText, notes, notify } = req.body;

    if (post !== undefined) {
      if (post === null) suggestion.post = null;
      else {
        const target = await BlogPost.findOne({ _id: post, deletedAt: null }).select("_id").lean();
        if (!target) return res.status(422).json({ error: "Post não encontrado (ou está na lixeira)" });
        suggestion.post = target._id;
      }
    }
    if (publicText !== undefined) suggestion.publicText = publicText;
    if (notes !== undefined) suggestion.notes = notes;
    if (status !== undefined && status !== suggestion.status) {
      suggestion.status = status;
      suggestion.doneAt = status === "done" ? new Date() : null;
    }

    const linked = suggestion.post
      ? await BlogPost.findById(suggestion.post).select("title slug published deletedAt").lean()
      : null;
    const postLive = Boolean(linked?.published && !linked.deletedAt);

    // R-SUG-04: atendida precisa do post que a atendeu
    if (suggestion.status === "done" && !suggestion.post) {
      return res.status(422).json({ error: "Escolha o post que atendeu a sugestão" });
    }

    // R-SUG-05: pública só atendida, com post publicado e texto público
    if (isPublic === true) {
      if (suggestion.status !== "done") return res.status(422).json({ error: "Só sugestão atendida aparece no blog" });
      if (!postLive) return res.status(422).json({ error: "O post da sugestão precisa estar publicado" });
      if (!suggestion.publicText) return res.status(422).json({ error: "Escreva o texto que vai aparecer no blog" });
    }
    if (isPublic !== undefined) suggestion.isPublic = isPublic;
    // Deixou de ser atendida ou perdeu o post/texto: sai do blog sozinha
    if (suggestion.status !== "done" || !suggestion.post || !suggestion.publicText) suggestion.isPublic = false;

    await suggestion.save();

    // R-SUG-07: aviso "virou post", uma vez só, com o post já no ar
    let notified = false;
    if (notify && suggestion.status === "done" && postLive && !suggestion.notifiedAt) {
      notified = await notifyReader(suggestion, linked);
      if (notified) {
        suggestion.notifiedAt = new Date();
        await suggestion.save();
      }
    }

    await suggestion.populate("post", "title slug status published");
    res.json({ ...suggestion.toObject(), notified });
  } catch (err) {
    next(err);
  }
});

// R-SUG-06: excluir é definitivo (pedido de exclusão da LGPD). A inscrição na
// newsletter, se a pessoa pediu, continua: sai pelo link do email ou em Assinantes.
router.delete("/admin/:id", auth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Sugestão não encontrada" });
    await connectDB();
    const removed = await Suggestion.findByIdAndDelete(req.params.id);
    if (!removed) return res.status(404).json({ error: "Sugestão não encontrada" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
