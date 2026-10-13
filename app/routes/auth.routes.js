const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const connectDB = require("../config/db.config");
const transporter = require("../config/mailer");
const resetPasswordEmail = require("../templates/resetPassword.email");
const { str } = require("../utils/sanitize");
const limiter = require("../services/ratelimit.service");

// Força bruta: 10 erros de login por IP a cada 15 min; 5 pedidos de nova senha por hora
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MIN = 15;
const FORGOT_MAX = 5;
const FORGOT_WINDOW_MIN = 60;

const router = express.Router();

const FRONTEND_URL =
  process.env.NODE_ENV === "production"
    ? process.env.CORS_PROD
    : process.env.CORS_DEV;

router.post("/login", async (req, res) => {
  try {
    await connectDB();

    // Só string: {"$ne": null} viraria operador do MongoDB
    const email = str(req.body?.email).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!email || !password) {
      return res.status(400).json({ message: "Dados inválidos" });
    }

    const wait = await limiter.blockedFor("login", req, LOGIN_MAX);
    if (wait) return limiter.tooMany(res, wait);

    const user = await User.findOne({ email });
    const passwordMatch = user && user.active && (await bcrypt.compare(password, user.password));

    if (!passwordMatch) {
      await limiter.hit("login", req, LOGIN_WINDOW_MIN);
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    await limiter.reset("login", req);

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("ERRO LOGIN:", err);
    return res.status(500).json({ message: "Erro interno" });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    await connectDB();

    const email = str(req.body?.email).toLowerCase();
    if (!email) {
      return res.status(400).json({ message: "Email é obrigatório" });
    }

    // Cada pedido conta (evita usar a rota para disparar emails em massa)
    const wait = await limiter.blockedFor("forgot", req, FORGOT_MAX);
    if (wait) return limiter.tooMany(res, wait);
    await limiter.hit("forgot", req, FORGOT_WINDOW_MIN);

    const user = await User.findOne({ email });

    // Resposta genérica sempre, para não revelar se o email existe ou não
    if (!user || !user.active) {
      return res.json({
        message: "Se o email existir, um link de redefinição foi enviado",
      });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hora
    await user.save();

    const resetUrl = `${FRONTEND_URL}/admin/reset-password?token=${rawToken}`;

    await transporter.sendMail({
      from: `"marck0101" <${process.env.GMAIL_USER}>`,
      to: user.email,
      subject: "Redefinição de senha | marck0101",
      html: resetPasswordEmail({ userName: user.name, resetUrl }),
    });

    return res.json({
      message: "Se o email existir, um link de redefinição foi enviado",
    });
  } catch (err) {
    console.error("ERRO FORGOT PASSWORD:", err);
    return res.status(500).json({ message: "Erro interno" });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    await connectDB();

    const token = str(req.body?.token);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!token || !password) {
      return res.status(400).json({ message: "Dados inválidos" });
    }

    if (password.length < 8) {
      return res
        .status(400)
        .json({ message: "A senha deve ter no mínimo 8 caracteres" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    }).select("+resetPasswordToken +resetPasswordExpires");

    if (!user) {
      return res.status(400).json({ message: "Token inválido ou expirado" });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return res.json({ message: "Senha redefinida com sucesso" });
  } catch (err) {
    console.error("ERRO RESET PASSWORD:", err);
    return res.status(500).json({ message: "Erro interno" });
  }
});

module.exports = router;
