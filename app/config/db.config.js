const mongoose = require("mongoose");

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const uri =
      process.env.NODE_ENV === "production"
        ? process.env.MONGO_URI_PROD
        : process.env.MONGO_URI_DEV;

    cached.promise = mongoose.connect(uri, {
      bufferCommands: false,
    });
  }

  cached.conn = await cached.promise;
  console.log("✅ MongoDB conectado");
  return cached.conn;
}

module.exports = connectDB;
