require("dotenv").config();
const app = require("./app/app");

const PORT = process.env.PORT || 3333;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`🚀 API rodando em http://localhost:${PORT}`);
    console.log(`🌱 Ambiente: ${process.env.NODE_ENV}`);
  });
}
