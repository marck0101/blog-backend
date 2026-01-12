const app = require("./app/app");

const PORT = process.env.PORT || 3333;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 API rodando na porta ${PORT}`);
  console.log(`🚀 API rodando em ${process.env.NODE_ENV}`);
});
