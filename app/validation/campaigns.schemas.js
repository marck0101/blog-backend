const { z } = require("zod");
const Campaign = require("../models/campaign.model");
const { text, id } = require("./fields");
const { audienceSchema } = require("./audience.schema");

/**
 * Formato dos envios (Envios no painel). O que não está aqui é descartado:
 * status, destinatários, rastreio e datas são do sistema.
 * A contagem de público (/audience-count) não tem esquema de propósito: é
 * chamada a cada clique no seletor e responde 0 para público incompleto.
 */

// Post de onde veio o conteúdo (opcional); "" = desligar
const linkedPost = z.union([id, z.literal(""), z.null()], { error: "Post inválido" });

const campaignBody = z.object({
  subject: text(300).optional(),
  preheader: text(500).optional(),
  content: z.string().optional(),
  audience: audienceSchema(Campaign.AUDIENCE_TYPES).optional(),
  post: linkedPost.optional(),
});

// Email de teste: sem email, vai para o admin logado (validado no controller)
const testBody = z.object({ email: text(254).optional() });

// Teste do aviso de post, com os campos do editor como estão na tela
const testPostBody = z.object({
  email: text(254).optional(),
  post: z
    .object({
      _id: id.nullable().optional(),
      title: text(300).optional(),
      slug: text(200).optional(),
      excerpt: text(500).optional(),
      category: text(60).optional(),
      coverImage: text(2000).nullable().optional(),
      emailSubject: text(300).optional(),
      emailPreheader: text(500).optional(),
      emailTeaser: text(3000).optional(),
    })
    .default({}),
});

// copy = mesmo público; new-members = só membros que ainda não receberam
const duplicateBody = z.object({ mode: z.enum(["copy", "new-members"]).default("copy") });

// Lista de envios (?post=&email=&kind=&status=&page=&limit=)
const listQuery = z.object({
  post: z.string().regex(/^[a-f0-9]{24}$/i, "Post inválido").optional(),
  email: text(254).optional(),
  kind: text(30).optional(),
  status: text(30).optional(),
  page: text(10).optional(),
  limit: text(10).optional(),
});

module.exports = { campaignBody, testBody, testPostBody, duplicateBody, listQuery };
