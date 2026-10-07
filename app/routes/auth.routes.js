const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const connectDB = require("../config/db.config");
const transporter = require("../config/mailer");
const resetPasswordEmail = require("../templates/resetPassword.email");

const router = express.Router();

const FRONTEND_URL =
  process.env.NODE_ENV === "production"
    ? process.env.CORS_PROD
    : process.env.CORS_DEV;

router.post("/login", async (req, res) => {
  try {
    await connectDB();

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Dados inválidos" });
    }

    const user = await User.findOne({ email });

    if (!user || !user.active) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

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

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email é obrigatório" });
    }

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

    const { token, password } = req.body;
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
