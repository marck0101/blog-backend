import { describe, expect, it } from "vitest";
import { asAdmin, models } from "../helpers.mjs";

const { Campaign } = models;

// VAL-01: formato dos envios (validation/campaigns.schemas.js)
describe("esquema dos envios", () => {
  it("payload do editor de envios é aceito", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/campaigns").send({
      subject: "Novidades",
      preheader: "Resumo",
      content: "<p>Olá</p>",
      audience: { type: "members", categories: [], subscribers: [], lists: [], excludeMembers: false },
      post: null,
    });
    expect(res.status).toBe(201);
  });

  it.each([
    ["público com tipo de post (post-category não vale em envio avulso)", { audience: { type: "post-category" } }],
    ["post que não é id", { post: "abc" }],
    ["assunto que não é texto", { subject: { $ne: null } }],
    ["assunto longo demais", { subject: "a".repeat(301) }],
  ])("%s: 422", async (_, body) => {
    const admin = await asAdmin();
    const res = await admin.post("/api/campaigns").send({ subject: "Oi", ...body });
    expect(res.status).toBe(422);
  });

  it("status e destinatários vindos do painel são descartados", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/campaigns").send({ subject: "Oi", status: "sent", recipients: [{ email: "x@y.dev" }] });
    const saved = await Campaign.findById(res.body._id).lean();
    expect(saved.status).toBe("draft");
    expect(saved.recipients).toEqual([]);
  });

  it("duplicar: modo desconhecido é recusado", async () => {
    const admin = await asAdmin();
    const campaign = await Campaign.create({ subject: "Oi" });
    expect((await admin.post(`/api/campaigns/${campaign._id}/duplicate`).send({ mode: "tudo" })).status).toBe(422);
    expect((await admin.post(`/api/campaigns/${campaign._id}/duplicate`).send({})).status).toBe(201);
  });

  it("lista: ?post= que não é id é recusado; parâmetros extras são ignorados", async () => {
    const admin = await asAdmin();
    expect((await admin.get("/api/campaigns?post=abc")).body).toEqual({ error: "Post inválido" });
    expect((await admin.get("/api/campaigns?_ts=123&qualquer=1")).status).toBe(200);
  });
});
