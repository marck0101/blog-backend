require("dotenv").config();

const express = require("express");
const cors = require("cors");

const connectDB = require("./app/config/db.config");
const seedAdminIfNeeded = require("./app/seed/seedAdmin");

const app = express();
const isProd = process.env.NODE_ENV === "production";

// =====================
// Middlewares
// =====================
app.use(
  cors({
    origin: isProd
      ? process.env.CORS_PROD
      : process.env.CORS_DEV,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================
// Health Check
// =====================
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    environment: isProd ? "production" : "development",
  });
});

// =====================
// Routes
// =====================
require("./app/routes/auth.routes")(app);
require("./app/routes/blogposts.routes")(app);

// =====================
// Start Server
// =====================
const PORT = process.env.PORT || 3333;

(async () => {
  try {
    await connectDB();
    await seedAdminIfNeeded();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 API rodando na porta ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Falha crítica:", err.message);
    process.exit(1);
  }
})();
