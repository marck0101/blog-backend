const crypto = require("crypto");
const mongoose = require("mongoose");
const Campaign = require("../models/campaign.model");
const EmailEvent = require("../models/emailEvent.model");
const { API_URL } = require("../config/urls");

/**
 * Rastreio de envios: pixel de abertura e links de clique por destinatário.
 *
 * As URLs levam campanha + assinante + assinatura HMAC. Sem a assinatura
 * certa nada é registrado, e o redirecionamento de clique só vai para a URL
 * que foi assinada no envio (não vira redirecionador aberto).
 */

const SECRET = () => process.env.TRACKING_SECRET || process.env.JWT_SECRET;

// Em dev os emails de teste apontam para a API local
const trackingBase = () =>
  process.env.NODE_ENV === "production" ? API_URL : `http://localhost:${process.env.PORT || 3333}`;

function sign(...parts) {
  return crypto.createHmac("sha256", SECRET()).update(parts.join(".")).digest("base64url").slice(0, 22);
}

function verify(sig, ...parts) {
  const expected = sign(...parts);
  return (
    typeof sig === "string" &&
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
}

function openPixelUrl(campaignId, subscriberId) {
  return `${trackingBase()}/api/t/o/${campaignId}/${subscriberId}/${sign(campaignId, subscriberId)}.gif`;
}

function clickUrl(campaignId, subscriberId, url) {
  const sig = sign(campaignId, subscriberId, url);
  return `${trackingBase()}/api/t/c/${campaignId}/${subscriberId}/${sig}?u=${encodeURIComponent(url)}`;
}

// Troca os links http(s) do HTML do email por links rastreados
function trackLinks(html, campaignId, subscriberId) {
  return (html || "").replace(/href="(https?:\/\/[^"]+)"/g, (match, href) => {
    const url = href.replace(/&amp;/g, "&");
    return `href="${clickUrl(campaignId, subscriberId, url).replace(/&/g, "&amp;")}"`;
  });
}

// Robôs, antivírus de email (clicam em tudo ao receber) e pré-carregamento
const BOT_UA = /bot|spider|crawl|scan|preview|monitor|curl|wget|python|java\/|go-http|headless|phantom|proofpoint|mimecast|barracuda|fortiguard|safelinks/i;
// Clique segundos depois da entrega = scanner do servidor de email, não pessoa
const SCANNER_WINDOW_MS = 10 * 1000;

function isAutomated(userAgent, sentAt, type) {
  if (!userAgent || BOT_UA.test(userAgent)) return true;
  if (type === "click" && sentAt && Date.now() - new Date(sentAt).getTime() < SCANNER_WINDOW_MS) return true;
  return false;
}

/**
 * Registra abertura/clique. Clique também conta como abertura: quem bloqueia
 * imagens não carrega o pixel, mas clicou, então abriu.
 */
async function record(type, campaignId, subscriberId, { userAgent, url } = {}) {
  if (!mongoose.isValidObjectId(campaignId) || !mongoose.isValidObjectId(subscriberId)) return;

  const campaign = await Campaign.findOne(
    { _id: campaignId, "recipients.subscriber": subscriberId },
    { "recipients.$": 1 }
  ).lean();
  const recipient = campaign?.recipients?.[0];
  if (!recipient) return;

  const automated = isAutomated(userAgent, recipient.sentAt, type);
  const now = new Date();

  await EmailEvent.create({
    campaign: campaignId,
    subscriber: subscriberId,
    type,
    url,
    automated,
    userAgent: (userAgent || "").slice(0, 300),
    at: now,
  });
  if (automated) return;

  const update = { $inc: {}, $min: {} };
  if (type === "open" || type === "click") {
    update.$inc["recipients.$.opens"] = type === "open" ? 1 : 0;
    update.$min["recipients.$.openedAt"] = now;
  }
  if (type === "click") {
    update.$inc["recipients.$.clicks"] = 1;
    update.$min["recipients.$.clickedAt"] = now;
  }
  await Campaign.updateOne({ _id: campaignId, "recipients.subscriber": subscriberId }, update, {
    timestamps: false,
  });
}

// Cancelamento pelo link de um envio (?c=): atribui a saída a ele
async function recordUnsubscribe(campaignId, subscriberId) {
  if (!mongoose.isValidObjectId(campaignId)) return;
  const res = await Campaign.updateOne(
    { _id: campaignId, "recipients.subscriber": subscriberId },
    { $min: { "recipients.$.unsubscribedAt": new Date() } },
    { timestamps: false }
  );
  if (res.matchedCount) {
    await EmailEvent.create({ campaign: campaignId, subscriber: subscriberId, type: "unsubscribe" });
  }
}

module.exports = {
  sign,
  verify,
  openPixelUrl,
  clickUrl,
  trackLinks,
  record,
  recordUnsubscribe,
  isAutomated,
};
