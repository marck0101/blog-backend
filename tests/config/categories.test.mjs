import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { api, asAdmin, models } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const CATEGORIES = require("../../app/config/categories");

// DUP-02 / R-POST-02: categorias numa lista só (app/config/categories.js)
describe("categorias", () => {
  it("o model de post aceita exatamente as categorias do config", () => {
    expect(models.BlogPost.schema.path("category").enumValues).toEqual(CATEGORIES.SLUGS);
  });

  it("/api/categories devolve só a lista (sem SLUGS)", async () => {
    const res = await api().get("/api/categories");
    expect(res.body).toEqual(CATEGORIES.map(({ slug, label }) => ({ slug, label })));
  });

  it("toda categoria do config vale num post, e fora dele não", async () => {
    const admin = await asAdmin();
    for (const slug of CATEGORIES.SLUGS) {
      const res = await admin.post("/api/posts").send({ title: `Post ${slug}`, category: slug });
      expect(res.status, slug).toBe(201);
    }
    expect((await admin.post("/api/posts").send({ title: "Post x", category: "inexistente" })).status).toBe(422);
  });

  it("assinante: mesma lista", async () => {
    const res = await api()
      .post("/api/subscribers")
      .set("Origin", "http://localhost:5173")
      .send({ email: "a@b.dev", categories: [...CATEGORIES.SLUGS, "inexistente"] });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Categorias inválidas: inexistente");
  });
});
