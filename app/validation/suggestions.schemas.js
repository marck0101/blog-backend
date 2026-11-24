const { z } = require("zod");
const { text, id } = require("./fields");
const { isEmail } = require("../utils/validators");

/**
 * Formato da caixinha de sugestões (VAL-01). Regras (categoria existe, post
 * publicado, quando pode ficar pública) ficam em app/routes/suggestion.routes.js.
 */

const kind = z.enum(["topic", "participate", "other"], { error: "Escolha o tipo da sugestão" });
const status = z.enum(["new", "planned", "done", "archived"], { error: "Status inválido" });

// Formulário público: nome e origem compridos são cortados, não recusados
const cut = (max) => z.string().trim().transform((value) => value.slice(0, max));

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 1500;

const createBody = z.object({
  kind: kind.default("topic"),
  category: text(60),
  message: z
    .string({ error: (issue) => (issue.input === undefined ? "Escreva a sugestão" : undefined) })
    .trim()
    .min(MESSAGE_MIN, `Conte um pouco mais: pelo menos ${MESSAGE_MIN} caracteres`)
    .max(MESSAGE_MAX, `A sugestão pode ter até ${MESSAGE_MAX} caracteres`),
  name: cut(100).optional(),
  email: z.string({ error: "Informe seu email" }).trim().refine(isEmail, "Email inválido"),
  allowName: z.boolean().optional(),
  subscribe: z.boolean().optional(),
  sourcePath: cut(200).optional(),
  // Armadilha para robôs: campo escondido que gente não preenche
  website: z.string().max(500).optional(),
});

const updateBody = z
  .object({
    status: status.optional(),
    // null desliga a sugestão do post
    post: id.nullable().optional(),
    isPublic: z.boolean().optional(),
    publicText: text(300).trim().optional(),
    notes: text(2000).trim().optional(),
    // Ao marcar como atendida: avisar a pessoa por email (padrão: não)
    notify: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), { error: "Nada para alterar" });

const adminListQuery = z.object({
  status: text(20).optional(),
  page: text(10).optional(),
});

module.exports = { createBody, updateBody, adminListQuery, MESSAGE_MIN, MESSAGE_MAX };
