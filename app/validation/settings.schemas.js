const { z } = require("zod");
const { FEATURE_NAMES } = require("../config/features");

/**
 * Liga/desliga recursos do blog: só os nomes conhecidos, só true/false, e o
 * código do app autenticador (dupla confirmação) (VAL-01)
 */
const featuresBody = z
  .object({
    ...Object.fromEntries(FEATURE_NAMES.map((name) => [name, z.boolean().optional()])),
    code: z.string({ error: "Digite o código do app autenticador" }).trim().regex(/^\d{6}$/, "O código tem 6 dígitos"),
  })
  .refine((body) => FEATURE_NAMES.some((name) => body[name] !== undefined), { error: "Nenhum recurso informado" });

module.exports = { featuresBody };
