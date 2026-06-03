const admin = require("firebase-admin");
const path = require("path");

if (!admin.apps.length) {
  let credential;

  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      // Produção (Vercel): JSON armazenado como variável de ambiente
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      credential = admin.credential.cert(serviceAccount);
    } else {
      // Desenvolvimento: arquivo local service-account.json na raiz do projeto
      const serviceAccount = require(path.join(__dirname, "../../service-account.json"));
      credential = admin.credential.cert(serviceAccount);
    }

    admin.initializeApp({
      credential,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  } catch (err) {
    console.warn(
      "⚠️  Firebase Admin não inicializado:",
      err.message,
      "\n   → Coloque service-account.json na raiz do projeto",
      "\n   → Ou defina FIREBASE_SERVICE_ACCOUNT_JSON no .env"
    );
  }
}

module.exports = admin;
