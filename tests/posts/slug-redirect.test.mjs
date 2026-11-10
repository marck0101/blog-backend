import { describe, expect, it } from "vitest";
import { api, asAdmin, createPost, models } from "../helpers.mjs";

const { BlogPost } = models;

// BIZ-04 / R-POST-17: mudar o endereço não quebra link já compartilhado
const publishedPost = (overrides = {}) =>
  createPost({ status: "published", published: true, publishedAt: new Date(), ...overrides });

describe("endereço (slug) do post", () => {
  it("slug digitado é normalizado: sem espaço, maiúscula ou acento", async () => {
    const admin = await asAdmin();
    const post = await publishedPost();
    const res = await admin.put(`/api/posts/${post._id}`).send({ slug: "  Guia Prático de SEO!  " });
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("guia-pratico-de-seo");
  });

  it("endereço antigo continua abrindo o post e informa o endereço atual", async () => {
    const admin = await asAdmin();
    const post = await publishedPost({ title: "Título antigo" });
    await admin.put(`/api/posts/${post._id}`).send({ slug: "titulo-novo" });

    const res = await api().get(`/api/posts/slug/${post.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("titulo-novo");
    expect(res.body).not.toHaveProperty("previousSlugs");
  });

  it("vários renomes: todos os endereços antigos levam ao atual", async () => {
    const admin = await asAdmin();
    const post = await publishedPost({ title: "Versão um" });
    await admin.put(`/api/posts/${post._id}`).send({ slug: "versao-dois" });
    await admin.put(`/api/posts/${post._id}`).send({ slug: "versao-tres" });

    for (const old of ["versao-um", "versao-dois"]) {
      expect((await api().get(`/api/posts/slug/${old}`)).body.slug).toBe("versao-tres");
    }
    expect((await BlogPost.findById(post._id).lean()).previousSlugs.sort()).toEqual(["versao-dois", "versao-um"]);
  });

  it("mudar o título sem mandar slug gera endereço novo e guarda o antigo", async () => {
    const admin = await asAdmin();
    const post = await publishedPost({ title: "Primeiro nome" });
    const res = await admin.put(`/api/posts/${post._id}`).send({ title: "Segundo nome" });
    expect(res.body.slug).toBe("segundo-nome");
    expect((await api().get("/api/posts/slug/primeiro-nome")).body.slug).toBe("segundo-nome");
  });

  it("voltar ao endereço antigo do próprio post é permitido e ele sai da lista de antigos", async () => {
    const admin = await asAdmin();
    const post = await publishedPost({ title: "Original" });
    await admin.put(`/api/posts/${post._id}`).send({ slug: "temporario" });
    const res = await admin.put(`/api/posts/${post._id}`).send({ slug: "original" });
    expect(res.status).toBe(200);
    expect((await BlogPost.findById(post._id).lean()).previousSlugs).toEqual(["temporario"]);
  });

  it("endereço antigo de outro post não pode ser reusado (o link abriria o post errado)", async () => {
    const admin = await asAdmin();
    const a = await publishedPost({ title: "Post A" });
    await admin.put(`/api/posts/${a._id}`).send({ slug: "post-a-novo" });

    const b = await publishedPost({ title: "Post B" });
    const manual = await admin.put(`/api/posts/${b._id}`).send({ slug: "post-a" });
    expect(manual.status).toBe(409);

    // Gerado do título também desvia do endereço antigo
    const created = await admin.post("/api/posts").send({ title: "Post A", category: "design" });
    expect(created.body.slug).toBe("post-a-1");
  });

  it("endereço antigo de post despublicado ou na lixeira não abre nada", async () => {
    const admin = await asAdmin();
    const post = await publishedPost({ title: "Vai sair" });
    await admin.put(`/api/posts/${post._id}`).send({ slug: "vai-sair-novo" });
    await admin.put(`/api/posts/${post._id}`).send({ status: "draft" });
    expect((await api().get("/api/posts/slug/vai-sair")).status).toBe(404);
  });

  it("o painel não grava previousSlugs direto", async () => {
    const admin = await asAdmin();
    const post = await publishedPost();
    await admin.put(`/api/posts/${post._id}`).send({ previousSlugs: ["sequestro"] });
    expect((await BlogPost.findById(post._id).lean()).previousSlugs).toEqual([]);
  });
});
