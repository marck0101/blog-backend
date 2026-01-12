const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const blogpostRoutes = require("./routes/blogposts.routes");

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
      // Permite chamadas server-to-server ou tools (Postman, curl)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

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

app.use("/api/auth", authRoutes);
app.use("/api/posts", blogpostRoutes);

/**
 * ===============================
 * ERROR HANDLER
 * ===============================
 */
app.use((err, req, res, next) => {
  console.error("Erro global:", err.message);
  res.status(500).json({
    message: "Internal server error",
  });
});

module.exports = app;
