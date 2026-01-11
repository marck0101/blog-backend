const express = require("express");
const serverless = require("serverless-http");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("../app/config/db.config");
const authRoutes = require("../app/routes/auth.routes");
const blogRoutes = require("../app/routes/blogposts.routes");

const app = express();

// ===== MIDDLEWARES =====
app.use(express.json());

app.use(
  cors({
    origin: process.env.CORS_PROD || "*",
    credentials: true,
  })
);

// ===== DB CACHE (SERVERLESS SAFE) =====
let cached = global.mongoose;
if (!cached) cached = global.mongoose = { conn: null };

async function dbConnect() {
  if (cached.conn) return cached.conn;
  cached.conn = await connectDB();
  return cached.conn;
}

// 🔴 ISSO É CRÍTICO: conectar DB ANTES DAS ROTAS
app.use(async (req, res, next) => {
  try {
    await dbConnect();
    next();
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "DB connection failed" });
  }
});

// ===== ROUTES =====
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV });
});

app.use("/api/auth", authRoutes);
app.use("/api/posts", blogRoutes);

// ❌ NÃO USE app.listen
module.exports = serverless(app);
