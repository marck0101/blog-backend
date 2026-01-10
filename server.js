require("dotenv").config();
const express = require("express");
const cors = require("cors");

const connectDB = require("./app/config/db.config");
const seedAdminIfNeeded = require("./app/seed/seedAdmin");

const authRoutes = require("./app/routes/auth.routes");

const app = express();

/* ======================
   ENV
====================== */
const isProd = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 3333;

const CORS_ORIGIN = isProd
  ? process.env.CORS_PROD
  : process.env.CORS_DEV;

/* ======================
   MIDDLEWARES
====================== */
app.use(express.json());
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
);

/* ======================
   ROUTES
====================== */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    environment: isProd ? "production" : "development",
  });
});

app.use("/api/auth", authRoutes);

/* ======================
   BOOTSTRAP
====================== */
(async () => {
  await connectDB();
  await seedAdminIfNeeded();
})();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 API rodando na porta ${PORT}`);
});
