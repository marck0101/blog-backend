const RateLimit = require("../models/ratelimit.model");
const { clientIp } = require("../utils/sanitize");

const keyFor = (action, req) => `${action}:${clientIp(req)}`;

// Bloqueado? Devolve os segundos até liberar, ou 0.
async function blockedFor(action, req, max) {
  const doc = await RateLimit.findOne({ key: keyFor(action, req) }).lean();
  if (!doc || doc.count < max) return 0;
  return Math.max(1, Math.ceil((new Date(doc.expiresAt) - Date.now()) / 1000));
}

// Soma uma tentativa; a janela conta a partir da primeira
async function hit(action, req, windowMinutes) {
  const key = keyFor(action, req);
  const updated = await RateLimit.findOneAndUpdate(
    { key, expiresAt: { $gt: new Date() } },
    { $inc: { count: 1 } },
    { new: true }
  );
  if (updated) return;
  try {
    // Sem janela ativa (nunca houve ou expirou): começa uma nova
    await RateLimit.findOneAndUpdate(
      { key },
      { count: 1, expiresAt: new Date(Date.now() + windowMinutes * 60 * 1000) },
      { upsert: true }
    );
  } catch (err) {
    // Duas tentativas simultâneas criando a mesma chave: soma na que venceu
    if (err.code !== 11000) throw err;
    await RateLimit.updateOne({ key }, { $inc: { count: 1 } });
  }
}

async function reset(action, req) {
  await RateLimit.deleteOne({ key: keyFor(action, req) });
}

function tooMany(res, seconds) {
  res.set("Retry-After", String(seconds));
  return res.status(429).json({
    message: `Muitas tentativas. Tente novamente em ${Math.ceil(seconds / 60)} minuto(s).`,
  });
}

module.exports = { blockedFor, hit, reset, tooMany };
