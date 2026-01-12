const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const connectDB = require("./config/db.config");

const authRoutes = require("./routes/auth.routes");
const blogpostRoutes = require("./routes/blogposts.routes");

const app = express();

/**
 * ===============================
 * DATABASE
 * ===============================
 */
connectDB();

/**
 * ===============================
 * MIDDLEWARES
 * ===============================
 */
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? process.env.CORS_PROD
        : process.env.CORS_DEV,
    credentials: true,
  })
);

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

/**
 * ===============================
 * ROUTES
 * ===============================
 */
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    environment: process.env.NODE_ENV,
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/blogposts", blogpostRoutes);

/**
 * ===============================
 * ERROR HANDLER
 * ===============================
 */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    message: "Internal server error",
  });
});

module.exports = app;
