const crypto = require("node:crypto");
const { TIMESTAMP_WINDOW_SEC } = require("../config/cockpit");

// Assinatura: HMAC-SHA256 (hex) de "<timestamp>.<corpo cru>" com o segredo da fonte
function signBody(secret, timestamp, rawBody) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
}

function signatureMatches(expectedHex, receivedHex) {
  if (typeof receivedHex !== "string" || !/^[0-9a-f]{64}$/i.test(receivedHex)) return false;
  return crypto.timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(receivedHex.toLowerCase(), "hex"));
}

// Timestamp em segundos, até 5 min para mais ou para menos
function timestampInWindow(value, now = Date.now()) {
  if (typeof value !== "string" || !/^\d{9,12}$/.test(value)) return false;
  return Math.abs(now / 1000 - Number(value)) <= TIMESTAMP_WINDOW_SEC;
}

// Dado de pessoa não entra no Cockpit: e-mail, telefone (10+ dígitos), CPF, CNPJ
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LONG_DIGITS = /(?:\d[\s().+-]*){10,}/;
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
const CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;

function looksLikePii(text) {
  return EMAIL.test(text) || CPF.test(text) || CNPJ.test(text) || LONG_DIGITS.test(text);
}

// Percorre qualquer valor (chaves e textos, em qualquer profundidade)
function containsPii(value, depth = 0) {
  if (depth > 6) return true; // profundidade absurda: trata como suspeito
  if (typeof value === "string") return looksLikePii(value);
  if (typeof value === "number") return Number.isInteger(value) && Math.abs(value) >= 1e10;
  if (Array.isArray(value)) return value.some((v) => containsPii(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([k, v]) => looksLikePii(k) || containsPii(v, depth + 1));
  }
  return false;
}

module.exports = { signBody, signatureMatches, timestampInWindow, looksLikePii, containsPii };
