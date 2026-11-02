const mongoose = require("mongoose");
const CATEGORIES = require("../config/categories");

/**
 * Validações de dados que se repetem entre rotas (DUP-03). Cada função
 * devolve um booleano (is…) ou a mensagem de erro para a pessoa (…Error / null).
 */

// Tamanho máximo de um endereço de email (RFC 5321)
const EMAIL_MAX = 254;
// Formato mínimo: algo@algo.algo, sem espaço. A confirmação real é o email chegar.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email em texto, com formato válido e até 254 caracteres */
function isEmail(value) {
  return typeof value === "string" && value.length <= EMAIL_MAX && EMAIL_RE.test(value);
}

/** Lista de categorias: null se todas existem; senão a mensagem com as inválidas */
function categoriesError(list) {
  if (!Array.isArray(list) || !list.every((c) => typeof c === "string")) return "Categorias inválidas";
  const invalid = list.filter((c) => !CATEGORIES.SLUGS.includes(c));
  return invalid.length ? `Categorias inválidas: ${invalid.join(", ")}` : null;
}

/**
 * Id do MongoDB: texto de 24 hexadecimais (vindo do painel) ou ObjectId (vindo
 * do banco). Qualquer outro objeto é recusado: { "$ne": null } viraria operador.
 */
function isId(value) {
  return value instanceof mongoose.Types.ObjectId || (typeof value === "string" && /^[a-f0-9]{24}$/i.test(value));
}

/** Lista de ids do MongoDB (ver isId) */
function isIdList(list) {
  return Array.isArray(list) && list.every(isId);
}

module.exports = { EMAIL_MAX, isEmail, categoriesError, isId, isIdList };
