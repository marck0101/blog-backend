require("dotenv").config();
const app = require("./app/app");
const connectDB = require("./app/config/db.config");
const seedAdminIfNeeded = require("./app/seed/seedAdmin");

const PORT = process.env.PORT || 3333;

if (process.env.NODE_ENV !== "production") {
  connectDB()
    .then(() => seedAdminIfNeeded())
    .then(() => {
      app.listen(PORT, () => {
        console.log(`🚀 API rodando em http://localhost:${PORT}`);
        console.log(`🌱 Ambiente: ${process.env.NODE_ENV}`);
      });
    })
    .catch((err) => {
      console.error("❌ Erro na inicialização:", err.message);
      process.exit(1);
    });
}
