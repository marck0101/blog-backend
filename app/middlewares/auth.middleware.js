const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const connectDB = require("../config/db.config");
const User = require("../models/user.model");

// Painel admin: token válido E usuário ainda ativo com papel admin.
// Conferir no banco faz um usuário desativado perder o acesso na hora,
// sem esperar o token (7 dias) expirar.
module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "Token não informado" });
  }

  const parts = authHeader.split(" ");

  if (parts.length !== 2) {
    return res.status(401).json({ message: "Token mal formatado" });
  }

  const [scheme, token] = parts;

  if (!/^Bearer$/i.test(scheme)) {
    return res.status(401).json({ message: "Token mal formatado" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ message: "Token inválido ou expirado" });
  }

  if (!mongoose.isValidObjectId(decoded?.id)) {
    return res.status(401).json({ message: "Token inválido ou expirado" });
  }

  try {
    await connectDB();
    const user = await User.findById(decoded.id).select("role active").lean();
    if (!user || !user.active || user.role !== "admin") {
      return res.status(401).json({ message: "Token inválido ou expirado" });
    }
    req.userId = decoded.id;
    return next();
  } catch (err) {
    return next(err);
  }
};
