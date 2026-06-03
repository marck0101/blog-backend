const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const blogpostRoutes = require("./routes/blogposts.routes");
const uploadRoutes = require("./routes/upload.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const subscriberRoutes = require("./routes/subscriber.routes");
const sitemapRoutes = require("./routes/sitemap.routes");
const CATEGORIES = require("./config/categories");

const app = express();

/**
 * ===============================
 * MIDDLEWARES BÁSICOS
 * ===============================
 */
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

/**
 * ===============================
 * CORS (DEV + PROD)
 * ===============================
 */
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://192.168.0.112:5173",
  "https://blog.marck0101.com.br",
  "https://www.blog.marck0101.com.br",
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

/**
 * ===============================
 * LOGS EM DEV
 * ===============================
 */
if (process.env.NODE_ENV !== "production") {
  const morgan = require("morgan");
  app.use(morgan("dev"));
}

/**
 * ===============================
 * ROTAS
 * ===============================
 */
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    environment: process.env.NODE_ENV,
  });
});

app.get("/api/categories", (req, res) => res.json(CATEGORIES));

app.use("/api/auth", authRoutes);
app.use("/api/posts", blogpostRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/subscribers", subscriberRoutes);
app.use("/", sitemapRoutes);

/**
 * ===============================
 * 404 — ROTA NÃO ENCONTRADA
 * ===============================
 */
app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

/**
 * ===============================
 * ERROR HANDLER GLOBAL
 * ===============================
 */
app.use((err, req, res, next) => {
  console.error(err);

  // Mongoose: erro de validação → 422
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors)[0]?.message || "Dados inválidos";
    return res.status(422).json({ error: message });
  }

  // Mongoose: ObjectId inválido → 400
  if (err.name === "CastError") {
    return res.status(400).json({ error: "ID inválido" });
  }

  // Mongoose: chave duplicada (slug, email) → 409
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "campo";
    return res.status(409).json({ error: `Já existe um registro com esse ${field}` });
  }

  const status = err.status || err.statusCode || 500;

  if (process.env.NODE_ENV === "production") {
    return res.status(status).json({ error: "Erro interno do servidor" });
  }

  res.status(status).json({
    error: err.message,
    stack: err.stack,
  });
});

module.exports = app;
