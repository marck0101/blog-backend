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

// Termo de busca que vale registrar/mostrar no painel: texto de gente, não
// sondagem de ReDoS como "(a+)+$" ou "(.*){1,30}". Letras, números, espaço e
// pontuação comum; ao menos 2 caracteres e uma letra ou número.
function isMeaningfulSearch(term) {
  if (typeof term !== "string") return false;
  const t = term.trim();
  return (
    t.length >= 2 &&
    t.length <= 80 &&
    /[\p{L}\p{N}]/u.test(t) &&
    /^[\p{L}\p{N}\s\-'".,:!?+#&/]+$/u.test(t)
  );
}

module.exports = { str, escapeRegex, clientIp, isMeaningfulSearch };
