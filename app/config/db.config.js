const mongoose = require("mongoose");

module.exports = async function connectDB() {
  const isProd = process.env.NODE_ENV === "production";

  const mongoURI = isProd
    ? process.env.MONGO_URI_PROD
    : process.env.MONGO_URI_DEV;

  if (!mongoURI) {
    throw new Error("MONGO_URI não definida");
  }

  await mongoose.connect(mongoURI);
  console.log(
    `✅ MongoDB conectado em modo ${isProd ? "PRODUÇÃO" : "DESENVOLVIMENTO"}`
  );
};
