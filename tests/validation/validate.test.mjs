import { createRequire } from "node:module";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { asAdmin, models } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const express = require("express");
const { z } = require("zod");
const { validate } = require("../../app/validation/validate");

// Mini app: o middleware sozinho, sem banco. Express 5: req.query é um getter.
const schemas = {
  query: z.object({ page: z.coerce.number().int().min(1).default(1), q: z.string().trim().optional() }),
  params: z.object({ id: z.coerce.number().int() }),
  body: z.object({ name: z.string().trim() }),
};
const app = express();
app.use(express.json());
app.post("/t/:id", validate(schemas), (req, res) => res.json({ query: req.query, params: req.params, body: req.body }));
app.get("/ok", validate({ query: schemas.query }), (req, res) => res.json({ query: req.query }));

describe("validate(): query no Express 5", () => {
  it("entrega ao controller o valor validado: padrão, número e sem campo extra", async () => {
    const res = await request(app).get("/ok").query({ q: "  oi  ", $where: "1", extra: "x" });
    expect(res.body.query).toEqual({ page: 1, q: "oi" });
  });

  it("converte string em número", async () => {
    const res = await request(app).get("/ok?page=3");
    expect(res.body.query.page).toBe(3);
  });

  it("formato inválido: 422 e controller não roda", async () => {
    const res = await request(app).get("/ok?page=0");
    expect(res.status).toBe(422);
  });

  it("params e body também chegam validados e sem campo extra", async () => {
    const res = await request(app).post("/t/42?page=2&x=1").send({ name: " Ana ", $inc: { a: 1 } });
    expect(res.body).toEqual({ query: { page: 2 }, params: { id: 42 }, body: { name: "Ana" } });
  });
});

// Com a query validada de verdade, o que o esquema não lista some: ?sort= precisa estar nele
describe("listas do painel continuam ordenáveis (?sort= no esquema)", () => {
  it("assinantes: ?sort=oldest", async () => {
    const admin = await asAdmin();
    await models.Subscriber.create({ email: "a@x.dev", createdAt: new Date("2026-01-01") });
    await models.Subscriber.create({ email: "b@x.dev", createdAt: new Date("2026-02-01") });
    const res = await admin.get("/api/subscribers?sort=oldest");
    expect(res.body.subscribers.map((s) => s.email)).toEqual(["a@x.dev", "b@x.dev"]);
  });

  it("envios: ?page=1&sort=subject", async () => {
    const admin = await asAdmin();
    await models.Campaign.create({ subject: "Zeta" });
    await models.Campaign.create({ subject: "Alfa" });
    const res = await admin.get("/api/campaigns?page=1&sort=subject");
    expect(res.body.campaigns.map((c) => c.subject)).toEqual(["Alfa", "Zeta"]);
  });
});
