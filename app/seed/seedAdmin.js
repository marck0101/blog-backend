const bcrypt = require("bcryptjs");
const User = require("../models/user.model");

module.exports = async function seedAdminIfNeeded() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_NAME) {
    console.log("ℹ️ Seed admin ignorado (variáveis ausentes)");
    return;
  }

  const exists = await User.findOne({ email: ADMIN_EMAIL });
  if (exists) {
    console.log("ℹ️ Usuário admin já existe");
    return;
  }

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

  await User.create({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    password: hashedPassword,
    role: "admin",
  });

  console.log("✅ Usuário admin criado com sucesso");
};
