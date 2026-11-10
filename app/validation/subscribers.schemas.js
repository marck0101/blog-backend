const { z } = require("zod");
const { text, categoryList } = require("./fields");
const { isEmail } = require("../utils/validators");

/**
 * Formato das rotas de assinantes (VAL-01). A existência das categorias é
 * conferida no controller (categoriesError), que conhece a lista.
 */

const email = z.string({ error: "Email inválido" }).trim().refine(isEmail, "Email inválido");

// Formulário público: nome e origem longos demais são cortados, não recusados
// (um link de origem comprido não pode impedir alguém de assinar)
const cut = (max) => z.string().trim().transform((value) => value.slice(0, max));

/* ================= PÚBLICO ================= */

// Origem da inscrição (página, post, UTM…): só estes campos, texto curto
const source = z.object({
  location: cut(200).optional(),
  path: cut(200).optional(),
  post: cut(200).optional(),
  landingPath: cut(200).optional(),
  referrer: cut(200).optional(),
  utmSource: cut(200).optional(),
  utmMedium: cut(200).optional(),
  utmCampaign: cut(200).optional(),
});

const subscribeBody = z.object({
  email,
  name: cut(100).optional(),
  categories: categoryList.default([]),
  source: source.optional(),
});

// Cancelar: envio de onde veio o link (o resto do corpo, como o
// "List-Unsubscribe=One-Click" do Gmail/Yahoo, é ignorado)
const unsubscribeBody = z.object({ c: text(30).optional() });

/* ================= PAINEL ================= */

const tier = z.enum(["free", "member"], { error: "Plano inválido" });
const status = z.enum(["active", "unsubscribed"], { error: "Status inválido" });

const manualBody = z.object({
  email,
  name: text(100).trim().optional(),
  categories: categoryList.default([]),
  tier: tier.default("free"),
  notes: text(2000).trim().optional(),
});

const updateBody = z.object({
  name: text(100).trim().optional(),
  notes: text(2000).trim().optional(),
  categories: categoryList.optional(),
  tier: tier.optional(),
  status: status.optional(),
});

// Filtros da lista e da exportação CSV
const listQuery = z.object({
  status: text(30).optional(),
  tier: text(30).optional(),
  list: text(30).optional(),
  categories: text(500).optional(),
  search: text(200).optional(),
  dateFrom: text(20).optional(),
  dateTo: text(20).optional(),
  page: text(10).optional(),
  limit: text(10).optional(),
});

module.exports = { subscribeBody, unsubscribeBody, manualBody, updateBody, listQuery };
