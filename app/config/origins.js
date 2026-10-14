// Origens do painel/blog. Usada pelo CORS e pela checagem de CSRF da sessão
// por cookie (ver middlewares/auth.middleware.js).
module.exports = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://192.168.0.112:5173",
  "http://192.168.0.145:5173",
  "https://blog.marck0101.com.br",
  "https://www.blog.marck0101.com.br",
];
