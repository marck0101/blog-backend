require("dotenv").config();
const mongoose = require("mongoose");
const app = require("./app/app");
const connectDB = require("./app/config/db.config");
const seedAdminIfNeeded = require("./app/seed/seedAdmin");

// Servidor local. Na Vercel a entrada é api/index.js — este arquivo não roda lá.
const PORT = process.env.PORT || 3333;
const isProd = process.env.NODE_ENV === "production";

connectDB()
  // Seed de admin só no banco de dev
  .then(() => (isProd ? null : seedAdminIfNeeded()))
  .then(() => {
    app
      .listen(PORT, () => {
        console.log(`🚀 API rodando em http://localhost:${PORT}`);
        console.log(`🌱 Ambiente: ${process.env.NODE_ENV}${isProd ? " (banco de PRODUÇÃO)" : ""}`);
        const { host, name } = mongoose.connection;
        console.log(`🗄️  Banco: ${name} @ ${host}`);
      })
      .on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          console.error(
            `❌ A porta ${PORT} já está em uso — provavelmente outra API (npm run dev ou npm run prod) ainda está rodando.\n` +
              "   Feche o outro terminal (Ctrl+C) antes de subir esta. Para ver quem usa a porta no PowerShell:\n" +
              `   Get-NetTCPConnection -LocalPort ${PORT} -State Listen | Select OwningProcess`
          );
        } else {
          console.error("❌ Erro ao abrir o servidor:", err.message);
        }
        process.exit(1);
      });
  })
  .catch((err) => {
    console.error("❌ Erro na inicialização:", err.message);
    process.exit(1);
  });
