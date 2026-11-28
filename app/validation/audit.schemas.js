const { z } = require("zod");
const AdminAuditLog = require("../models/adminAuditLog.model");

// Lista do registro de ações (?page=&limit=&action=&from=&to=). Datas "YYYY-MM-DD" (Brasília).
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use AAAA-MM-DD)");

const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.enum(AdminAuditLog.ACTIONS, { error: "Ação inválida" }).optional(),
  from: day.optional(),
  to: day.optional(),
});

module.exports = { listQuery };
