/**
 * Emergência: perdeu o celular E os códigos de recuperação.
 * Apaga o app autenticador do usuário e derruba as sessões abertas; no próximo
 * login (Google ou senha) a tela pede para cadastrar o app de novo.
 *
 * Só funciona com acesso ao banco (o .env com a URI), de propósito: pelo site
 * não existe jeito de pular o 2º fator.
 *
 * Uso:
 *   node scripts/reset-2fa.js voce@gmail.com           # banco DEV
 *   node scripts/reset-2fa.js voce@gmail.com --prod    # banco PROD
 *   ... --unlink-google   também desvincula a conta Google
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../app/models/user.model");

const args = process.argv.slice(2);
const email = (args.find((a) => !a.startsWith("--")) || "").toLowerCase();
const PROD = args.includes("--prod");
const UNLINK_GOOGLE = args.includes("--unlink-google");

if (!email) {
  console.error("Informe o email. Ex.: node scripts/reset-2fa.js voce@gmail.com");
  process.exit(1);
}

async function main() {
  await mongoose.connect(PROD ? process.env.MONGO_URI_PROD : process.env.MONGO_URI_DEV);
  const update = {
    $unset: { "mfa.secret": "", "mfa.pendingSecret": "" },
    $set: { "mfa.enabledAt": null, "mfa.lastStep": -1, "mfa.recoveryCodes": [] },
    $inc: { sessionVersion: 1 },
  };
  if (UNLINK_GOOGLE) update.$set.googleSub = null;

  const r = await User.updateOne({ email }, update);
  if (r.matchedCount === 0) {
    console.error(`Nenhum usuário com o email ${email} no banco ${PROD ? "PROD" : "DEV"}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`2º fator removido de ${email} (${PROD ? "PROD" : "DEV"})${UNLINK_GOOGLE ? " e Google desvinculado" : ""}.`);
  console.log("Sessões abertas encerradas. No próximo login, cadastre o app autenticador de novo.");
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
