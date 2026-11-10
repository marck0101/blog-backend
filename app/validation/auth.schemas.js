const { z } = require("zod");
const { text } = require("./fields");

/**
 * Formato das rotas de login e conta (VAL-01). Estas rotas respondem 400
 * (validate(..., { status: 400 })): contrato coberto por tests/security.
 * Senha errada, código errado e limite de tentativas continuam nas rotas.
 */

const invalid = { error: "Dados inválidos" };

const loginBody = z.object({
  email: z.string(invalid).trim().toLowerCase().min(1).max(254),
  password: z.string(invalid).min(1).max(200),
}, invalid);

const forgotBody = z.object({
  email: z.string({ error: "Email é obrigatório" }).trim().toLowerCase().min(1).max(254),
});

const resetBody = z.object({
  token: z.string(invalid).trim().min(1).max(200),
  // Mínimo de 8 é conferido na rota (mensagem própria)
  password: z.string(invalid).min(1).max(200),
}, invalid);

// Código do app autenticador (6 dígitos) ou de recuperação ("ab12-cd34")
const codeBody = z.object({ code: text(40).optional() });

module.exports = { loginBody, forgotBody, resetBody, codeBody };
