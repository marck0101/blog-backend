require("dotenv").config();

const express = require("express");
const cors = require("cors");

const connectDB = require("./config/db.config");
const seedAdminIfNeeded = require("./seed/seedAdmin");

const authRoutes = require("./routes/auth.routes");
const blogRoutes = require("./routes/blogposts.routes");

const app = express();
const isProd = process.env.NODE_ENV === "production";

// ===== MIDDLEWARES =====
app.use(express.json());

app.use(
  cors({
    origin: isProd ? process.env.CORS_PROD : process.env.CORS_DEV || "*",
    credentials: true,
  })
);

// ===== DB CACHE (SERVERLESS SAFE) =====
let cached = global.mongoose;
if (!cached) cached = global.mongoose = { conn: null };

async function dbConnect() {
  if (cached.conn) return cached.conn;
  cached.conn = await connectDB();
  await seedAdminIfNeeded();
  return cached.conn;
}

// conecta DB antes das rotas
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

module.exports = app;
