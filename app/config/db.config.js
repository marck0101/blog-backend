const mongoose = require("mongoose");

const connectDB = async () => {
  const isProd = process.env.NODE_ENV === "production";

  const mongoURI = isProd
    ? process.env.MONGO_URI_PROD
    : process.env.MONGO_URI_DEV;

  try {
    if (!mongoURI) {
      throw new Error("MONGO_URI não definida para o ambiente atual");
    }

    await mongoose.connect(mongoURI);

    console.log(
      `✅ MongoDB conectado em modo ${isProd ? "PRODUÇÃO" : "DESENVOLVIMENTO"}`
    );
  } catch (error) {
    console.error("❌ Erro ao conectar no MongoDB:", error.message);

    if (mongoURI) {
      console.log("Mongo URI:", mongoURI.replace(/:\/\/.*@/, "://***:***@"));
    }

    process.exit(1);
  }
};

module.exports = connectDB;
