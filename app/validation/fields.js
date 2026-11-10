const { z } = require("zod");

/**
 * Campos reutilizáveis dos esquemas (VAL-01). Nomes dizem o que aceitam.
 * Limites de tamanho seguem o model e o editor; são generosos de propósito:
 * o esquema barra lixo e abuso, não conteúdo legítimo.
 */

/** Texto com limite de caracteres */
const text = (max) => z.string().max(max);

/** Id do MongoDB em texto (24 hexadecimais) */
const id = z.string().regex(/^[a-f0-9]{24}$/i, "Id inválido");

/** Lista de ids */
const idList = z.array(id).max(5000);

/** Lista de slugs de categoria (a existência é conferida pela regra de negócio) */
const categoryList = z.array(text(60)).max(50);

/** Data do formulário ("YYYY-MM-DD") ou instante ISO; null/"" = sem data */
const dateInput = z.string().max(40).nullable();

// :id inválido na URL não passa por aqui: o tratador global já responde
// 400 "ID inválido" (CastError do Mongoose), contrato coberto por teste.

module.exports = { text, id, idList, categoryList, dateInput };
