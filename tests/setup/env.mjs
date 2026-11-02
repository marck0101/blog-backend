import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, beforeEach, inject, vi } from "vitest";

// Roda antes de cada arquivo de teste, antes de qualquer require da app.
const uri = inject("mongoUri");

// Trava: os testes apagam o banco a cada teste. Só um banco local em memória serve.
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  throw new Error(`Testes recusados: banco inesperado (${uri})`);
}

Object.assign(process.env, {
  // Mesmo fuso da Vercel: teste que só passa no fuso do Brasil esconderia bug de produção
  TZ: "UTC",
  NODE_ENV: "test",
  MONGO_URI_DEV: uri,
  MONGO_URI_PROD: "",
  JWT_SECRET: "segredo-de-teste-".repeat(4),
  TRACKING_SECRET: "",
  MFA_SECRET_KEY: "",
  CRON_SECRET: "cron-de-teste",
  SKIP_2FA: "false",
  // Sem credenciais de email, LinkedIn e Firebase: nada sai para fora
  GMAIL_USER: "",
  GMAIL_APP_PASSWORD: "",
  ADMIN_EMAIL: "",
  LINKEDIN_CLIENT_ID: "",
  LINKEDIN_CLIENT_SECRET: "",
  LINKEDIN_REDIRECT_URI: "",
  FIREBASE_SERVICE_ACCOUNT_JSON: "",
});
delete process.env.VERCEL;

// require nativo: a app é CommonJS e o teste precisa da mesma instância dos
// módulos que a app usa (mongoose, transporter...)
const require = createRequire(import.meta.url);
const mongoose = require("mongoose");
const transporter = require("../../app/config/mailer");
const connectDB = require("../../app/config/db.config");

// Conectado desde o início: o teste pode usar os models antes de chamar uma rota
beforeAll(() => connectDB());

// Nenhum teste envia email de verdade. Quem precisar confere as chamadas:
// expect(transporter.sendMail).toHaveBeenCalled...
beforeEach(() => {
  vi.spyOn(transporter, "sendMail").mockResolvedValue({ messageId: "teste" });
  // Nenhum teste chama serviço externo (LinkedIn, Google...). Quem precisar
  // substitui com vi.stubGlobal("fetch", ...) no próprio teste.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("Rede bloqueada nos testes")));
});

// Banco limpo entre testes
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (mongoose.connection.readyState === 1) {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  global.mongoose = { conn: null, promise: null };
});
