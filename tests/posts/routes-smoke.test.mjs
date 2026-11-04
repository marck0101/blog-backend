import { describe, expect, it, vi } from "vitest";
import { PANEL_ORIGIN, api, asAdmin, createPost, models } from "../helpers.mjs";

// Toda rota de post responde sem erro de servidor. Pega import faltando ou
// nome errado depois de mover código (DUP-07): esse tipo de erro só aparece
// quando a rota é chamada.
describe("rotas de post respondem (nenhum 500)", () => {
  it("todas as 26", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = await asAdmin();
    await models.Season.create({ title: "Série", slug: "serie" });
    const post = await createPost({
      status: "published",
      published: true,
      publishedAt: new Date(),
      season: "serie",
      seasonOrder: 1,
      gallery: [{ url: "https://img/a.webp" }],
    });
    const trashed = await createPost({ title: "Na lixeira", deletedAt: new Date() });
    const id = post._id;

    const calls = [
      // público
      ["get", "/api/posts/published"],
      ["get", `/api/posts/public/${id}`],
      ["get", `/api/posts/public/${id}/related`],
      ["get", `/api/posts/slug/${post.slug}`],
      ["get", "/api/posts/season/serie"],
      ["get", "/api/posts/pinned"],
      ["get", "/api/posts/highlights"],
      ["post", `/api/posts/public/${id}/engage`, { type: "share", channel: "whatsapp" }, true],
      // painel
      ["post", "/api/posts", { title: "Novo post", category: "design" }],
      ["get", "/api/posts"],
      ["get", "/api/posts/deleted/all"],
      ["get", "/api/posts/calendar?from=2026-11-01&to=2026-11-30"],
      ["get", "/api/posts/heatmap"],
      ["get", "/api/posts/today-planned"],
      ["get", "/api/posts/showcase"],
      ["put", "/api/posts/showcase/pinned", { ids: [String(id)] }],
      ["patch", `/api/posts/${id}/highlight`, { highlight: "force" }],
      ["get", `/api/posts/${id}`],
      ["put", `/api/posts/${id}`, { title: "Título editado", slug: post.slug }],
      ["get", `/api/posts/${id}/revisions`],
      ["get", `/api/posts/${id}/revisions/1`],
      ["post", `/api/posts/${id}/revisions/1/restore`],
      ["delete", `/api/posts/${id}/images`, { imageUrl: "https://img/a.webp" }],
      ["patch", `/api/posts/${trashed._id}/restore`],
      ["delete", `/api/posts/${trashed._id}`],
      ["delete", `/api/posts/${trashed._id}/hard`],
    ];
    expect(calls).toHaveLength(26);

    const results = [];
    for (const [method, url, body, publicRoute] of calls) {
      const req = publicRoute ? api()[method](url).set("Origin", PANEL_ORIGIN) : admin[method](url);
      const res = await (body ? req.send(body) : req);
      results.push(`${res.status} ${method.toUpperCase()} ${url}`);
    }

    expect(results.filter((r) => r.startsWith("5"))).toEqual([]);
    expect(results.filter((r) => !/^2\d\d /.test(r))).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });
});
