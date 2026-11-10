import { afterEach, describe, expect, it } from "vitest";
import { PANEL_ORIGIN, api, asAdmin } from "../helpers.mjs";

// Tratador global de erros (app.js): o que chega ao navegador em cada caso.
describe("respostas de erro", () => {
  const nodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
  });

  it("produção: 4xx explica o que foi recusado, sem stack", async () => {
    process.env.NODE_ENV = "production";
    const res = await api()
      .post("/api/subscribers")
      .set("Origin", PANEL_ORIGIN)
      .set("Content-Type", "application/json")
      .send("{json quebrado");
    expect(res.status).toBe(400);
    expect(res.body.error).not.toBe("Erro interno do servidor");
    expect(res.body.stack).toBeUndefined();
  });

  it("produção: origem não permitida é 403 com motivo", async () => {
    process.env.NODE_ENV = "production";
    const res = await api().get("/api/health").set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Origem não permitida" });
  });

  it("ID inválido vira 400, não 500", async () => {
    const admin = await asAdmin();
    const res = await admin.get("/api/posts/nao-e-um-id");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "ID inválido" });
  });

  it("slug duplicado vira 409", async () => {
    const admin = await asAdmin();
    const post = { title: "Mesmo título", category: "tecnologia", slug: "mesmo-slug" };
    await admin.post("/api/posts").send(post);
    const res = await admin.post("/api/posts").send(post);
    expect(res.status).toBe(409);
  });
});
