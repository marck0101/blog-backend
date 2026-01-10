const User = require("../models/user.model");

const seedAdminIfNeeded = async () => {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_NAME) {
    console.log("⚠️ Seed admin ignorado (variáveis não definidas)");
    return;
  }

  const existingAdmin = await User.findOne({ email: ADMIN_EMAIL });

  if (existingAdmin) {
    console.log("ℹ️ Usuário admin já existe");
    return;
  }

  await User.create({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    role: "admin",
  });

  console.log("✅ Usuário admin criado com sucesso");
};

module.exports = seedAdminIfNeeded;
