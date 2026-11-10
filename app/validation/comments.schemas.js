const { z } = require("zod");
const { text } = require("./fields");

/**
 * Formato dos comentários (VAL-01). Limpeza e tamanho do texto (caracteres de
 * controle, linhas em branco, 2000 caracteres) ficam em cleanBody, nas rotas.
 */

// Folga acima do limite real: quem corta e explica é o cleanBody
const body = z.string({ required_error: "Escreva o comentário" }).max(10000);

// Resposta a um comentário principal (a existência é conferida na rota)
const parentId = z.string().regex(/^[a-f0-9]{24}$/i, "Comentário inválido");

const newCommentBody = z.object({
  body,
  parentId: parentId.nullable().optional(),
});

const replyBody = z.object({ body });

const moderateBody = z.object({
  status: z.enum(["pending", "approved", "rejected"], { errorMap: () => ({ message: "Status inválido" }) }),
  // Motivo da recusa: o limite real (500) é conferido na rota, depois do cleanBody
  reason: z.string().max(10000).nullable().optional(),
  // Avisar o leitor da recusa por email (padrão: sim)
  notify: z.boolean().optional(),
});

const adminListQuery = z.object({
  status: text(20).optional(),
  post: text(30).optional(),
  page: text(10).optional(),
  sort: text(20).optional(),
});

module.exports = { newCommentBody, replyBody, moderateBody, adminListQuery };
