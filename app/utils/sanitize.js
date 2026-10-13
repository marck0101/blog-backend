// Entradas vindas de fora (query/body) só como string. Objetos como {"$ne": null}
// virariam operadores do MongoDB (NoSQL injection) e arrays quebrariam .trim().
function str(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Busca por texto literal: "c++" ou "(a+)+$" não viram expressão regular
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// IP do cliente. Na Vercel, x-real-ip/x-forwarded-for são definidos pela borda.
function clientIp(req) {
  return (
    req.headers["x-real-ip"] ||
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.ip ||
    "desconhecido"
  );
}

module.exports = { str, escapeRegex, clientIp };
