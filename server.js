require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./app/config/db.config");
const seedAdminIfNeeded = require("./app/seed/seedAdmin");

const app = express();
const isProd = process.env.NODE_ENV === "production";

// DB
(async () => {
  await connectDB();
  await seedAdminIfNeeded(); // 👈 SEED AUTOMÁTICO EM DEV
})();

// Middlewares
app.use(
  cors({
    origin: isProd ? process.env.CORS_PROD : process.env.CORS_DEV,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    environment: isProd ? "production" : "development",
  });
});

// Routes
require("./app/routes/auth.routes")(app);
require("./app/routes/blogposts.routes")(app);

// Server
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 API rodando na porta ${PORT}`);
});
