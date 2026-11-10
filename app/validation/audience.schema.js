const { z } = require("zod");
const { idList, categoryList } = require("./fields");

/**
 * Público de um email (envio avulso ou aviso de post), com os tipos permitidos
 * de quem usa. Formato só; regras ("selecione pelo menos 1 categoria",
 * categoria existente) ficam em campaign.controller.validateAudience.
 */
function audienceSchema(types) {
  return z.object({
    type: z.enum(types, { error: "Público inválido" }),
    categories: categoryList.optional(),
    subscribers: idList.optional(),
    lists: idList.optional(),
    excludeMembers: z.boolean().optional(),
  });
}

module.exports = { audienceSchema };
