const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const blogpostRoutes = require("./routes/blogposts.routes");
const uploadRoutes = require("./routes/upload.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const subscriberRoutes = require("./routes/subscriber.routes");
const campaignRoutes = require("./routes/campaign.routes");
const cronRoutes = require("./routes/cron.routes");
const linkedinRoutes = require("./routes/linkedin.routes");
const trackingRoutes = require("./routes/tracking.routes");
const metricsRoutes = require("./routes/metrics.routes");
const sitemapRoutes = require("./routes/sitemap.routes");
const CATEGORIES = require("./config/categories");
const allowedOrigins = require("./config/origins");

const app = express();

// Segurança básica:
// - não anunciar o framework (X-Powered-By: Express)
// - query string "simple": ?search[$ne]=x não vira objeto/operador do MongoDB
app.disable("x-powered-by");
app.set("query parser", "simple");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
  });
  next();
});

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
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // 403, não 500: é uma recusa esperada, não falha do servidor
      const err = new Error("Origem não permitida");
      err.status = 403;
      return callback(err);
    },
    credentials: true,
  })
);

/**
 * ===============================
 * LOGS EM DEV
 * ===============================
 */
if (!["production", "test"].includes(process.env.NODE_ENV)) {
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

// Lista fixa (muda só com deploy): navegador guarda 1h, CDN 1 dia
app.get("/api/categories", (req, res) => {
  res.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
  res.json(CATEGORIES);
});

app.use("/api/auth", authRoutes);
app.use("/api/posts", blogpostRoutes);
app.use("/api/seasons", require("./routes/season.routes"));
app.use("/api/upload", uploadRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/subscribers", subscriberRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/cron", cronRoutes);
app.use("/api/linkedin", linkedinRoutes);
app.use("/api/t", trackingRoutes);
app.use("/api/metrics", metricsRoutes);
app.use("/api/comments", require("./routes/comment.routes"));
app.use("/api/audiences", require("./routes/audience.routes"));
app.use("/api/csp-report", require("./routes/csp.routes"));
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
// Erros do Mongoose que são dado inválido, não falha do servidor
function knownError(err) {
  // Validação do schema → 422
  if (err.name === "ValidationError") {
    return { status: 422, error: Object.values(err.errors)[0]?.message || "Dados inválidos" };
  }
  // ObjectId inválido → 400
  if (err.name === "CastError") return { status: 400, error: "ID inválido" };
  // Chave duplicada (slug, email) → 409
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "campo";
    return { status: 409, error: `Já existe um registro com esse ${field}` };
  }
  return null;
}

app.use((err, req, res, next) => {
  const known = knownError(err);
  const status = known?.status || err.status || err.statusCode || 500;

  // Recusa esperada (dado inválido, origem não permitida…) sai sem stack, para
  // os logs destacarem só o que é falha do servidor
  if (status >= 500) console.error(err);
  else console.warn(`[HTTP ${status}] ${req.method} ${req.originalUrl}: ${known?.error || err.message}`);

  if (known) return res.status(status).json({ error: known.error });

  if (process.env.NODE_ENV === "production") {
    // Só o 5xx esconde o detalhe; o 4xx explica o que foi recusado
    return res.status(status).json({ error: status >= 500 ? "Erro interno do servidor" : err.message });
  }

  res.status(status).json({
    error: err.message,
    stack: err.stack,
  });
});

module.exports = app;
