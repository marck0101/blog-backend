const { z } = require("zod");
const { FEATURE_NAMES } = require("../config/features");

/** Liga/desliga recursos do blog: só os nomes conhecidos, só true/false (VAL-01) */
const featuresBody = z
  .object(Object.fromEntries(FEATURE_NAMES.map((name) => [name, z.boolean().optional()])))
  .refine((body) => Object.values(body).some((v) => v !== undefined), { error: "Nenhum recurso informado" });

module.exports = { featuresBody };
