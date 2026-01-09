const User = require("../models/user.model");

async function seedAdminIfNeeded() {
  if (process.env.NODE_ENV !== "development") {
    return; // segurança: nunca roda fora de DEV
  }

  const email = "marck_mhc";
  const password = "Q!W@E#R$";

  const count = await User.countDocuments();

  if (count > 0) {
    console.log("ℹ️ Seed DEV ignorado (já existem usuários)");
    return;
  }

  await User.create({
    name: "Administrador",
    email,
    password,
  });

  console.log("✅ Usuário admin DEV criado automaticamente");
}

module.exports = seedAdminIfNeeded;
