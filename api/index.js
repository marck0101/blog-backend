const express = require("express");
const serverless = require("serverless-http");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("../app/config/db.config");

const authRoutes = require("../app/routes/auth.routes");
const blogRoutes = require("../app/routes/blogposts.routes");

const app = express();

// Middlewares
app.use(express.json());
app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? process.env.CORS_PROD
    : process.env.CORS_DEV,
  credentials: true
}));

// DB
let isConnected = false;
async function db() {
  if (!isConnected) {
    await connectDB();
    isConnected = true;
  }
}

// Health
app.get("/api/health", async (req, res) => {
  await db();
  res.json({ status: "ok", env: process.env.NODE_ENV });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/posts", blogRoutes);

// Exporta handler
module.exports.handler = serverless(app);
