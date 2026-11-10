import { describe, expect, it } from "vitest";
import { api, asAdmin, createPost } from "../helpers.mjs";

// Campos de SEO vindos da main (tags, leituras sugeridas, resposta direta)
// passam pelo esquema da rota (VAL-01) e chegam ao banco.
describe("tags, leituras sugeridas e resposta direta", () => {
  it("o editor grava os três e o painel recebe as leituras com título", async () => {
    const admin = await asAdmin();
    const other = await createPost({ title: "Outro post", status: "published", published: true, publishedAt: new Date() });

    const res = await admin.post("/api/posts").send({
      title: "Post com links",
      category: "tecnologia",
      directAnswer: "A conclusão em uma frase.",
      tags: "Core Web Vitals, GA4",
      relatedPosts: [String(other._id)],
    });

    expect(res.status).toBe(201);
    expect(res.body.directAnswer).toBe("A conclusão em uma frase.");
    expect(res.body.tags).toEqual(["core-web-vitals", "ga4"]);
    expect(res.body.relatedPosts).toEqual([expect.objectContaining({ _id: String(other._id), title: "Outro post" })]);
  });

  it("leitura sugerida com id inválido é recusada pelo esquema", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/posts").send({ title: "Post", category: "tecnologia", relatedPosts: ["x"] });
    expect(res.status).toBe(422);
  });

  it("'Continue lendo' começa pelas escolhidas à mão", async () => {
    const pub = { status: "published", published: true, publishedAt: new Date() };
    const picked = await createPost({ ...pub, title: "Escolhida", category: "design" });
    await createPost({ ...pub, title: "Mesma categoria", category: "tecnologia", views: 100 });
    const post = await createPost({ ...pub, title: "Atual", relatedPosts: [picked._id] });

    const res = await api().get(`/api/posts/public/${post._id}/related`);
    expect(res.status).toBe(200);
    expect(res.body.map((p) => p.title)).toEqual(["Escolhida", "Mesma categoria"]);
  });
});
