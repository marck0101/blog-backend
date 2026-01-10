const bcrypt = require("bcryptjs");
const User = require("../models/user.model");

const seedAdminIfNeeded = async () => {
  try {
    const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;

    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      console.log("ℹ️ Seed admin ignorado (variáveis não definidas)");
      return;
    }

    const adminExists = await User.findOne({ role: "admin" });

    if (adminExists) {
      console.log("ℹ️ Usuário admin já existe");
      return;
    }

    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

    await User.create({
      name: ADMIN_NAME || "Administrador",
      email: ADMIN_EMAIL,
      password: hashedPassword,
      role: "admin",
      active: true,
    });

    console.log("✅ Usuário ADMIN criado com sucesso");
  } catch (err) {
    console.error("❌ Erro ao criar admin:", err.message);
  }
};

module.exports = seedAdminIfNeeded;
