const { z } = require("zod");
const { text } = require("./fields");

/**
 * Formato das seasons no painel (VAL-01). Título, slug e tamanhos finais são
 * conferidos também pelo model (mensagens dele).
 */

// FAQ: só pares completos vão para o banco; o resto é descartado (não recusado),
// porque o formulário pode mandar uma linha que a pessoa começou e não terminou
const faq = z
  .array(z.object({ question: text(200).trim().default(""), answer: text(1500).trim().default("") }))
  .max(50)
  .transform((items) => items.filter((item) => item.question && item.answer));

const seasonBody = z.object({
  title: text(100).trim().optional(),
  slug: text(100).trim().optional(),
  description: text(600).trim().optional(),
  // Ordem na página /seasons; vazio ou inválido vira 0
  order: z
    .union([z.number(), text(10), z.null()])
    .transform((value) => {
      const order = parseInt(value, 10);
      return Number.isFinite(order) ? order : 0;
    })
    .optional(),
  faq: faq.optional(),
});

module.exports = { seasonBody };
