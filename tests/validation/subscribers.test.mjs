import { describe, expect, it } from "vitest";
import { PANEL_ORIGIN, api, asAdmin, models } from "../helpers.mjs";

// VAL-01: formato das rotas de assinantes (validation/subscribers.schemas.js)
describe("esquema dos assinantes", () => {
  it("inscrição pública: origem e nome longos são cortados, não recusados", async () => {
    const res = await api()
      .post("/api/subscribers")
      .set("Origin", PANEL_ORIGIN)
      .send({ email: "  leitor@x.dev ", name: "N".repeat(150), source: { referrer: "r".repeat(500), extra: "descartado" } });
    expect(res.status).toBe(201);
    const saved = await models.Subscriber.findOne({ email: "leitor@x.dev" }).lean();
    expect(saved.name).toHaveLength(100);
    expect(saved.source.referrer).toHaveLength(200);
    expect(saved.source).not.toHaveProperty("extra");
  });

  it("inscrição pública: email inválido ou ausente", async () => {
    for (const body of [{}, { email: "sem-arroba" }, { email: { $ne: null } }]) {
      const res = await api().post("/api/subscribers").set("Origin", PANEL_ORIGIN).send(body);
      expect(res.body).toEqual({ error: "Email inválido" });
    }
  });

  it("painel: plano e status fora da lista", async () => {
    const admin = await asAdmin();
    const sub = await models.Subscriber.create({ email: "a@b.dev" });
    expect((await admin.patch(`/api/subscribers/${sub._id}`).send({ tier: "vip" })).body).toEqual({ error: "Plano inválido" });
    expect((await admin.patch(`/api/subscribers/${sub._id}`).send({ status: "banido" })).body).toEqual({ error: "Status inválido" });
  });

  it("painel: token e lista de públicos não são editáveis por aqui", async () => {
    const admin = await asAdmin();
    const sub = await models.Subscriber.create({ email: "a@b.dev" });
    const token = sub.token;
    await admin.patch(`/api/subscribers/${sub._id}`).send({ token: "sequestro", lists: ["64b000000000000000000000"], name: "Novo" });
    const saved = await models.Subscriber.findById(sub._id).lean();
    expect(saved).toMatchObject({ token, lists: [], name: "Novo" });
  });
});
