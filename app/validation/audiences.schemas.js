const { z } = require("zod");
const { text, categoryList } = require("./fields");

/** Formato dos públicos nomeados (listas) do painel (VAL-01) */

// O painel manda a lista em partes; cada chamada cabe no tempo da função serverless
const IMPORT_MAX_ROWS = 1000;

const name = text(80).trim();
const description = text(300).trim();

const createBody = z.object({
  name: name.min(1, "O nome do público é obrigatório"),
  description: description.default(""),
});

const updateBody = z.object({
  name: name.min(1, "O nome do público é obrigatório").optional(),
  description: description.optional(),
});

// Importação: cada linha é conferida no controller, que devolve quais linhas
// não serviram (uma linha ruim não recusa o arquivo inteiro)
const importBody = z.object({
  consent: z.literal(true, { errorMap: () => ({ message: "Confirme que as pessoas da lista autorizaram receber seus emails" }) }),
  rows: z
    .array(z.record(z.unknown()), { required_error: "A lista está vazia" })
    .min(1, "A lista está vazia")
    .max(IMPORT_MAX_ROWS, `Envie no máximo ${IMPORT_MAX_ROWS} linhas por vez`),
  categories: categoryList.default([]),
});

module.exports = { createBody, updateBody, importBody };
