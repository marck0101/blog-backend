const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// Credencial da service account (nunca vai para o git):
// - Produção (Vercel): FIREBASE_SERVICE_ACCOUNT_JSON com o JSON inteiro
// - Dev: arquivo service-account.json na raiz do backend
const SERVICE_ACCOUNT_FILE = path.join(__dirname, "../../service-account.json");

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
    return JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, "utf8"));
  }
  return null;
}

if (!admin.apps.length) {
  try {
    const serviceAccount = loadServiceAccount();

    if (!serviceAccount) {
      // A API funciona normalmente; só o upload de imagens fica indisponível (503)
      console.warn(
        "⚠️  Firebase sem credencial: upload de imagens desativado.\n" +
          "   → Copie o service-account.json para a raiz do blog-backend\n" +
          "   → ou defina FIREBASE_SERVICE_ACCOUNT_JSON no .env"
      );
    } else {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      });
    }
  } catch (err) {
    console.warn("⚠️  Firebase Admin não inicializado:", err.message);
  }
}

module.exports = admin;
