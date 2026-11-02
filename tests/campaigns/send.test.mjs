import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asAdmin, models } from "../helpers.mjs";

const { Campaign, Subscriber } = models;

// Envio de rascunho pelo painel: o público salvo no banco (ids como ObjectId)
// precisa passar na mesma validação do público vindo do formulário (ids em texto).
describe("enviar rascunho", () => {
  const env = {};
  beforeEach(() => {
    env.GMAIL_USER = process.env.GMAIL_USER;
    env.GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
    Object.assign(process.env, { GMAIL_USER: "blog@teste.dev", GMAIL_APP_PASSWORD: "x" });
  });
  afterEach(() => Object.assign(process.env, env));

  it("público 'assinantes específicos' criado pelo painel é enviado", async () => {
    const admin = await asAdmin();
    const sub = await Subscriber.create({ email: "leitor@x.dev" });
    const created = await admin
      .post("/api/campaigns")
      .send({ subject: "Oi", content: "<p>Olá</p>", audience: { type: "selected", subscribers: [String(sub._id)] } });
    expect(created.status).toBe(201);

    const sent = await admin.post(`/api/campaigns/${created.body._id}/send`);
    expect(sent.status).toBe(200);
    expect(sent.body.stats.sent).toBe(1);
  });

  it("público 'públicos nomeados' também", async () => {
    const admin = await asAdmin();
    const AudienceList = (await import("node:module")).createRequire(import.meta.url)("../../app/models/audienceList.model");
    const list = await AudienceList.create({ name: "Clientes" });
    await Subscriber.create({ email: "cliente@x.dev", lists: [list._id] });
    const draft = await Campaign.create({ subject: "Oi", content: "<p>Olá</p>", audience: { type: "lists", lists: [list._id] } });

    const sent = await admin.post(`/api/campaigns/${draft._id}/send`);
    expect(sent.status).toBe(200);
    expect(sent.body.stats.sent).toBe(1);
  });
});
