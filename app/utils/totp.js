const crypto = require("crypto");

// TOTP (RFC 6238) — o mesmo código de 6 dígitos do Google Authenticator,
// Authy, 1Password etc. Passo de 30 s, HMAC-SHA1.
const STEP_SECONDS = 30;
const DIGITS = 6;
// Aceita o código do passo anterior e do seguinte (relógio do celular ±30 s)
const WINDOW = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) throw new Error("Segredo TOTP inválido");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 20 bytes (160 bits), o tamanho recomendado para HMAC-SHA1
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Confere o código. lastStep = último passo já usado: o mesmo código não vale
 * duas vezes (quem viu você digitar não reaproveita).
 * Devolve o passo aceito (para gravar como lastStep) ou null.
 */
function verifyTotp(secret, code, lastStep = -1, now = Date.now()) {
  const typed = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return null;
  const step = currentStep(now);
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const candidate = step + delta;
    if (candidate <= lastStep) continue;
    const expected = codeAt(secret, candidate);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(typed))) return candidate;
  }
  return null;
}

// Link que o app autenticador entende (vira o QR code)
function otpauthUrl(secret, account, issuer) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

module.exports = { generateSecret, verifyTotp, otpauthUrl, codeAt, currentStep };
