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
    origin:
      process.env.NODE_ENV === "production"
        ? process.env.CORS_PROD
        : process.env.CORS_DEV || "*",
    credentials: true,
  })
);

// ===== DB (CACHEADO PARA SERVERLESS) =====
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null };
}

async function dbConnect() {
  if (cached.conn) return cached.conn;
  cached.conn = await connectDB();
  return cached.conn;
}

// ===== HEALTH =====
app.get("/api/health", async (req, res) => {
  try {
    await dbConnect();
    res.json({ status: "ok", env: process.env.NODE_ENV });
  } catch (err) {
    res.status(500).json({ error: "DB connection failed" });
  }
});

// ===== ROUTES =====
app.use("/api/auth", authRoutes);
app.use("/api/posts", blogRoutes);

// ===== EXPORT SERVERLESS =====
module.exports.handler = serverless(app);
