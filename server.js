require("dotenv").config();

const express = require("express");
const cors = require("cors");

const connectDB = require("./app/config/db.config");
const seedAdminIfNeeded = require("./app/seed/seedAdmin");

const authRoutes = require("./app/routes/auth.routes");
const blogRoutes = require("./app/routes/blogposts.routes");

const app = express();
const PORT = process.env.PORT || 3333;
const isProd = process.env.NODE_ENV === "production";

app.use(express.json());

app.use(
  cors({
    origin: isProd ? process.env.CORS_PROD : process.env.CORS_DEV || "*",
    credentials: true,
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/posts", blogRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV });
});

(async () => {
  await connectDB();
  await seedAdminIfNeeded();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 API rodando na porta ${PORT}`);
  });
})();
