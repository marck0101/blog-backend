const crypto = require("crypto");
const AdminAuditLog = require("../models/adminAuditLog.model");
const { clientIp } = require("../utils/sanitize");

/**
 * Registro de ações do admin (SEC-09, R-AUD-*).
 *
 *   await audit.record(req, "post.trash", { type: "post", id: post._id, label: post.slug }, { ... });
 *
 * Nunca lança: falha ao gravar o registro não pode derrubar a ação (R-AUD-02).
 * Guarda só o necessário: ver docs/SISTEMA.md seção 25.
 */

const LABEL_MAX = 120;
const UA_MAX = 120;
const META_KEYS_MAX = 10;
const META_STRING_MAX = 80;
// Chaves de meta que nunca entram, mesmo que alguém passe sem querer (R-AUD-04)
const FORBIDDEN_META = /token|password|senha|secret|cookie|authorization|email|phone|telefone|cpf|cnpj|name|nome/i;

// IP vira HMAC curto: dá para comparar com um IP conhecido, não para ler o IP
function hashIp(ip) {
  const key = process.env.JWT_SECRET || "audit";
  return crypto.createHmac("sha256", key).update(String(ip)).digest("hex").slice(0, 16);
}

const clip = (value, max) => (value == null ? null : String(value).slice(0, max));

// Só valores simples, poucas chaves, textos curtos
function cleanMeta(meta) {
  const out = {};
  if (!meta || typeof meta !== "object") return out;
  for (const [key, value] of Object.entries(meta)) {
    if (Object.keys(out).length >= META_KEYS_MAX) break;
    if (FORBIDDEN_META.test(key)) continue;
    if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string") out[key] = value.slice(0, META_STRING_MAX);
  }
  return out;
}

/**
 * @param req     requisição (admin logado em req.user, IP e user-agent)
 * @param action  uma de AdminAuditLog.ACTIONS
 * @param target  { type, id, label } (opcional)
 * @param meta    números/textos curtos (ex.: { audienceSize: 120 })
 * @param actor   { id, email } quando não há req.user (login)
 */
async function record(req, action, target = {}, meta = {}, actor = null) {
  try {
    const who = actor || (req?.user ? { id: req.user._id, email: req.user.email } : null);
    await AdminAuditLog.create({
      action,
      actor: { userId: who?.id ? String(who.id) : null, email: who?.email || null },
      target: {
        type: target.type || null,
        id: target.id ? String(target.id) : null,
        label: clip(target.label, LABEL_MAX),
      },
      ipHash: req ? hashIp(clientIp(req)) : null,
      userAgent: clip(req?.headers?.["user-agent"], UA_MAX),
      meta: cleanMeta(meta),
    });
  } catch (err) {
    console.error("[AUDIT] Falha ao registrar", action, "-", err.message);
  }
}

// Publicar/tirar do ar pelo painel: compara o status de antes e o de depois
async function recordPostStatus(req, before, post) {
  const was = before?.status === "published";
  const is = post?.status === "published";
  if (was === is) return;
  await record(req, is ? "post.publish" : "post.unpublish", { type: "post", id: post._id, label: post.slug });
}

module.exports = { record, recordPostStatus, hashIp };
