const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["admin", "editor", "user"],
      default: "user",
    },

    active: {
      type: Boolean,
      default: true,
    },

    resetPasswordToken: {
      type: String,
      select: false,
    },

    resetPasswordExpires: {
      type: Date,
      select: false,
    },

    // Conta Google vinculada (o "sub" do Google não muda, o email pode mudar).
    // Gravado no 1º login com Google; depois só esse sub entra.
    googleSub: { type: String, default: null, select: false },

    // Segundo fator: app autenticador (TOTP). Segredos criptografados (utils/secretBox).
    mfa: {
      enabledAt: { type: Date, default: null },
      secret: { type: String, select: false },
      // Gerado no cadastro, vira `secret` quando o primeiro código confere
      pendingSecret: { type: String, select: false },
      // Último passo de 30 s usado: o mesmo código não vale duas vezes
      lastStep: { type: Number, default: -1, select: false },
      // Códigos de recuperação (sha256), cada um vale uma vez
      recoveryCodes: { type: [String], default: [], select: false },
    },

    // Sobe ao sair, ao trocar a senha ou ao refazer o 2º fator: derruba
    // todas as sessões abertas (o JWT carrega a versão em que foi emitido)
    sessionVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
