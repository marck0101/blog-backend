const { z } = require("zod");
const { text, id } = require("./fields");

/**
 * Sugestão de link interno (R-MAP-06). O editor manda o que está na tela
 * (tags e texto ainda não salvos); o formato é conferido aqui.
 */
const suggestionsBody = z.object({
  postId: id.optional(),
  tags: z.array(text(80)).max(20).default([]),
  content: text(2_000_000).default(""),
});

module.exports = { suggestionsBody };
