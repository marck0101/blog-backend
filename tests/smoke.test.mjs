import { describe, expect, it } from "vitest";
import { api, asAdmin, createPost, models } from "./helpers.mjs";

describe("estrutura de testes", () => {
  it("API responde", async () => {
    const res = await api().get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("rota do painel sem sessão é recusada", async () => {
    const res = await api().get("/api/posts");
    expect(res.status).toBe(401);
  });

  it("admin logado lista os posts", async () => {
    const admin = await asAdmin();
    await createPost();
    const res = await admin.get("/api/posts");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("banco começa limpo em cada teste", async () => {
    expect(await models.BlogPost.countDocuments()).toBe(0);
  });
});
