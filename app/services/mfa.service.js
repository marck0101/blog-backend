const User = require("../models/user.model");
const { verifyTotp } = require("../utils/totp");
const { openSecret } = require("../utils/secretBox");
const { errorBody } = require("../utils/http");

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
  return res.status(500).json(
    errorBody(
      "O servidor não consegue ler o app autenticador cadastrado (a chave MFA_SECRET_KEY/JWT_SECRET mudou). " +
        "Use um código de recuperação ou rode scripts/reset-2fa.js."
    )
  );
}

/**
 * Confirmação de ação sensível do painel com o código do app autenticador
 * (dupla confirmação). Cada código vale uma vez: grava o passo usado.
 * Devolve { ok: true } ou { ok: false, reason: "wrong" | "reused" | "no-mfa" }.
 */
async function confirmAppCode(userId, code) {
  const user = await User.findById(userId).select("+mfa.secret +mfa.lastStep");
  if (!user?.mfa?.secret) return { ok: false, reason: "no-mfa" };
  const secret = await userSecret(user, "secret");
  const lastStep = user.mfa.lastStep ?? -1;
  const step = verifyTotp(secret, code, lastStep);
  if (step === null) {
    return { ok: false, reason: verifyTotp(secret, code, -1) !== null ? "reused" : "wrong" };
  }
  // Atômico: dois pedidos com o mesmo código ao mesmo tempo, só um passa
  const { modifiedCount } = await User.updateOne(
    { _id: user._id, $or: [{ "mfa.lastStep": { $lt: step } }, { "mfa.lastStep": { $exists: false } }, { "mfa.lastStep": null }] },
    { $set: { "mfa.lastStep": step } }
  );
  return modifiedCount ? { ok: true } : { ok: false, reason: "reused" };
}

module.exports = { SecretUnreadable, userSecret, secretUnreadable, confirmAppCode };
