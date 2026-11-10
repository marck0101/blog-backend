const { z } = require("zod");

/**
 * Validação por esquema das rotas (VAL-01).
 *
 *   router.put("/:id", auth, validate({ params: idParams, body: postBody }), controller.update)
 *
 * Cada parte (params, query, body) que tiver esquema é conferida antes do
 * controller. Errou: 422 { error: "mensagem para a pessoa" }. Passou: a parte é
 * trocada pela versão validada — campo desconhecido é descartado (inclusive
 * operadores do MongoDB como "$inc" e campos que só o sistema grava).
 *
 * O esquema cuida do FORMATO (tipo, tamanho, valores permitidos). Regra de
 * negócio (ex.: agendado precisa de data) continua no controller/regras.
 */

const PARTS = ["params", "query", "body"];

// Mensagens padrão em português; o esquema pode trocar por uma própria
const fieldName = (path) => (path.length ? path.join(".") : "dados");
z.config({
  customError: (issue) => {
    const field = fieldName(issue.path || []);
    switch (issue.code) {
      case "invalid_type":
        return issue.input === undefined ? `Campo obrigatório: ${field}` : `Valor inválido em ${field}`;
      case "too_big":
        return issue.origin === "array" ? `${field}: no máximo ${issue.maximum} itens` : `${field}: no máximo ${issue.maximum} caracteres`;
      case "too_small":
        return issue.origin === "array" ? `${field}: pelo menos ${issue.minimum} item(ns)` : `${field}: pelo menos ${issue.minimum} caracteres`;
      case "invalid_value":
        return `${field}: valor não permitido`;
      default:
        return `Valor inválido em ${field}`;
    }
  },
});

/**
 * status: código da resposta quando o formato não serve. Padrão 422; as rotas
 * de login usam 400 "Dados inválidos" (contrato coberto por tests/security).
 */
function validate(schemas, { status = 422 } = {}) {
  return (req, res, next) => {
    for (const part of PARTS) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) return res.status(status).json({ error: result.error.issues[0].message });
      req[part] = result.data;
    }
    next();
  };
}

module.exports = { validate };
