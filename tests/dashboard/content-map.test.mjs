import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { api, asAdmin, createPost, models } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const { internalSlugs } = require("../../app/services/contentMap.service");

const published = { status: "published", published: true, publishedAt: new Date() };
const linkTo = (href) => `<p>Veja <a href="${href}">este post</a> para entender melhor.</p>`;

// Seção 20 do SISTEMA.md: mapa de conteúdo do painel
describe("links internos no texto", () => {
  it("reconhece link relativo e com o domínio do blog; ignora outros sites e a home", () => {
    const html = [
      '<a href="/blog/um-post">a</a>',
      '<a href="https://blog.marck0101.com.br/blog/outro-post?utm_source=x#secao">b</a>',
      '<a href="/blog/um-post/">repetido</a>',
      '<a href="https://outro-site.com/blog/nao-conta">c</a>',
      '<a href="/blog">home</a>',
      '<a href="//blog.marck0101.com.br/blog/protocolo">d</a>',
      "<a href='/blog/aspas-simples'>e</a>",
    ].join("");
    expect(internalSlugs(html)).toEqual(["um-post", "outro-post", "aspas-simples"]);
  });
});

describe("mapa de conteúdo", () => {
  it("só o admin vê", async () => {
    expect((await api().get("/api/dashboard/content-map")).status).toBe(401);
  });

  it("liga posts por link no texto, leitura sugerida, tag e season", async () => {
    const admin = await asAdmin();
    await models.Season.create({ title: "Funil completo", slug: "funil" });
    const b = await createPost({ ...published, title: "Post B", slug: "post-b", tags: ["ga4"], season: "funil" });
    const a = await createPost({ ...published, title: "Post A", slug: "post-a", content: linkTo("/blog/post-b"), tags: ["ga4"], relatedPosts: [b._id], season: "funil" });

    const res = await admin.get("/api/dashboard/content-map");
    expect(res.status).toBe(200);
    const { nodes, links } = res.body;

    expect(nodes.find((n) => n.id === "tag:ga4")).toMatchObject({ type: "tag", count: 2 });
    expect(nodes.find((n) => n.id === "season:funil")).toMatchObject({ type: "season", label: "Funil completo", count: 2 });
    expect(links).toEqual(
      expect.arrayContaining([
        { source: String(a._id), target: String(b._id), type: "link" },
        { source: String(a._id), target: String(b._id), type: "related" },
        { source: String(a._id), target: "tag:ga4", type: "tag" },
        { source: String(b._id), target: "season:funil", type: "season" },
      ])
    );
    expect(nodes.find((n) => n.id === String(b._id)).inbound).toBe(2);
    // O conteúdo dos posts não vai para o painel
    expect(JSON.stringify(res.body)).not.toContain("este post");
  });

  it("diagnóstico: órfãos, links quebrados e tags soltas", async () => {
    const admin = await asAdmin();
    const draft = await createPost({ title: "Rascunho", slug: "rascunho" });
    await createPost({ title: "Na lixeira", slug: "na-lixeira", deletedAt: new Date() });
    const renamed = await createPost({ ...published, title: "Renomeado", slug: "endereco-novo", previousSlugs: ["endereco-velho"] });
    const hub = await createPost({
      ...published,
      title: "Pilar",
      slug: "pilar",
      tags: ["sozinha"],
      content: [linkTo("/blog/rascunho"), linkTo("/blog/na-lixeira"), linkTo("/blog/nao-existe"), linkTo("/blog/endereco-velho")].join(""),
    });
    // Rascunho aponta para o pilar: não tira o pilar da lista de órfãos (só publicado conta)
    await models.BlogPost.updateOne({ _id: draft._id }, { content: linkTo("/blog/pilar") });

    const { insights } = (await admin.get("/api/dashboard/content-map")).body;

    expect(insights.orphans.map((o) => o.slug)).toEqual(["pilar"]);
    expect(insights.brokenLinks.map((b) => [b.from.slug, b.href, b.reason])).toEqual([
      ["pilar", "/blog/rascunho", "unpublished"],
      ["pilar", "/blog/na-lixeira", "trash"],
      ["pilar", "/blog/nao-existe", "missing"],
      ["pilar", "/blog/endereco-velho", "old-slug"],
    ]);
    expect(insights.brokenLinks.find((b) => b.reason === "old-slug").target.slug).toBe("endereco-novo");
    expect(insights.singleTags).toEqual([{ tag: "sozinha", post: expect.objectContaining({ id: String(hub._id) }) }]);
    // Lixeira fora da contagem. O link pelo endereço antigo ainda conta para o
    // renomeado (o 301 funciona): por isso ele não é órfão.
    expect(insights.totals).toMatchObject({ posts: 3, published: 2 });
    expect(insights.brokenLinks.find((b) => b.reason === "old-slug").target.id).toBe(String(renamed._id));
  });
});
