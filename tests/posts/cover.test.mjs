import { describe, expect, it } from "vitest";
import { api, createPost } from "../helpers.mjs";

const pub = { status: "published", published: true, publishedAt: new Date("2026-11-27T15:00:00Z") };

describe("GET /api/posts/slug/:slug/cover.png", () => {
  it("post publicado sem capa recebe PNG com cache de CDN", async () => {
    const post = await createPost({ ...pub, title: "Post sem capa própria", category: "trafego" });
    const res = await api().get(`/api/posts/slug/${post.slug}/cover.png?tema=escuro`).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toContain("s-maxage");
    expect(res.body.subarray(1, 4).toString()).toBe("PNG");
  });

  it("post com capa própria nunca é sobrescrito: redireciona para a dele", async () => {
    const post = await createPost({ ...pub, title: "Com capa", coverImage: "https://exemplo.com/capa.webp" });
    const res = await api().get(`/api/posts/slug/${post.slug}/cover.png`).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://exemplo.com/capa.webp");
  });

  it("rascunho e slug inexistente dão 404", async () => {
    const draft = await createPost({ title: "Rascunho secreto", status: "draft", published: false });
    expect((await api().get(`/api/posts/slug/${draft.slug}/cover.png`)).status).toBe(404);
    expect((await api().get("/api/posts/slug/nao-existe/cover.png")).status).toBe(404);
  });
});
