import { describe, expect, it } from "vitest";
import { api, asAdmin, createPost } from "../helpers.mjs";

const published = (daysAgo = 0) => ({ status: "published", published: true, publishedAt: new Date(Date.now() - daysAgo * 86400000) });
const URL = "/api/content-map/suggestions";

// R-MAP-06: sugestão de link interno no editor
describe("sugestões de link interno", () => {
  it("só o admin acessa", async () => {
    expect((await api().post(URL).send({ tags: ["ga4"] })).status).toBe(401);
  });

  it("valida o formato", async () => {
    const admin = await asAdmin();
    expect((await admin.post(URL).send({ postId: "nao-e-id", tags: [] })).status).toBe(422);
    expect((await admin.post(URL).send({ tags: "ga4" })).status).toBe(422);
  });

  it("ordena por tags em comum e depois por recência; máximo 5", async () => {
    const admin = await asAdmin();
    const me = await createPost({ title: "Atual", slug: "atual", tags: ["ga4", "seo"] });
    await createPost({ ...published(10), title: "Uma tag antigo", slug: "uma-antigo", tags: ["ga4"] });
    await createPost({ ...published(1), title: "Uma tag novo", slug: "uma-novo", tags: ["seo"] });
    await createPost({ ...published(30), title: "Duas tags", slug: "duas", tags: ["ga4", "seo"] });
    for (let i = 0; i < 5; i++) await createPost({ ...published(40 + i), title: `Extra ${i}`, slug: `extra-${i}`, tags: ["ga4"] });

    const res = await admin.post(URL).send({ postId: String(me._id), tags: ["GA4", "seo"] });
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toHaveLength(5);
    expect(res.body.suggestions.map((s) => s.slug).slice(0, 3)).toEqual(["duas", "uma-novo", "uma-antigo"]);
    expect(res.body.suggestions[0]).toMatchObject({
      title: "Duas tags",
      url: "https://blog.marck0101.com.br/blog/duas",
      sharedTags: ["ga4", "seo"],
    });
  });

  it("ignora o próprio post, rascunho, lixeira, sem tag em comum e quem o texto já linka", async () => {
    const admin = await asAdmin();
    const me = await createPost({ ...published(), title: "Atual", slug: "atual", tags: ["ga4"] });
    await createPost({ title: "Rascunho", slug: "rascunho", tags: ["ga4"] });
    await createPost({ ...published(), title: "Lixeira", slug: "lixeira", tags: ["ga4"], deletedAt: new Date() });
    await createPost({ ...published(), title: "Outro assunto", slug: "outro", tags: ["css"] });
    await createPost({ ...published(), title: "Já linkado", slug: "ja-linkado", tags: ["ga4"] });
    await createPost({ ...published(), title: "Renomeado", slug: "novo-endereco", previousSlugs: ["velho"], tags: ["ga4"] });
    await createPost({ ...published(), title: "Livre", slug: "livre", tags: ["ga4"] });

    const content = '<p><a href="https://blog.marck0101.com.br/blog/ja-linkado">a</a> <a href="/blog/velho">b</a></p>';
    const res = await admin.post(URL).send({ postId: String(me._id), tags: ["ga4"], content });
    expect(res.body.suggestions.map((s) => s.slug)).toEqual(["livre"]);
  });

  it("funciona para post ainda não salvo e sem tags devolve lista vazia", async () => {
    const admin = await asAdmin();
    await createPost({ ...published(), title: "Alvo", slug: "alvo", tags: ["ga4"] });
    const novo = await admin.post(URL).send({ tags: ["ga4"] });
    expect(novo.body.suggestions.map((s) => s.slug)).toEqual(["alvo"]);
    const vazio = await admin.post(URL).send({ tags: [] });
    expect(vazio.body.suggestions).toEqual([]);
  });
});
