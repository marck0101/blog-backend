import { describe, expect, it } from "vitest";
import { asAdmin, createPost, models } from "../helpers.mjs";

const { BlogPost, Subscriber } = models;

// SEC-05: dado com tipo errado (objeto, lista, número no lugar de texto) é
// recusado com 422 e nunca vira erro 500 nem operador do MongoDB.

describe("posts", () => {
  // Mesmo formato do PostEditor (blog-front/src/components/PostEditor → save)
  const editorPayload = {
    title: "Post completo",
    slug: "",
    excerpt: "Resumo",
    content: "<p>Conteúdo com mais de dez caracteres.</p>",
    category: "marketing",
    season: "",
    seasonOrder: "",
    status: "draft",
    plannedAt: "2026-12-01",
    emailNotify: true,
    emailTeaser: "",
    emailSubject: "",
    emailPreheader: "",
    emailAudience: { type: "post-category", categories: [], subscribers: [], lists: [], excludeMembers: false },
    linkedin: { enabled: false, text: "", imageUrl: "", comment: "" },
    seo: { title: "", description: "" },
    coverImageAlt: "",
    faq: [{ question: "Pergunta?", answer: "Resposta." }],
    published: false,
    gallery: [],
    coverImage: "",
  };

  it("payload real do editor continua funcionando (criar e editar)", async () => {
    const admin = await asAdmin();
    const created = await admin.post("/api/posts").send(editorPayload);
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe("post-completo");
    expect(created.body.faq).toHaveLength(1);

    const updated = await admin.put(`/api/posts/${created.body._id}`).send({ ...editorPayload, slug: created.body.slug, title: "Post completo v2" });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe("Post completo v2");
    expect(updated.body.slug).toBe("post-completo");
  });

  it("publicar de novo pelo calendário mantém a data da primeira publicação (R-POST-06)", async () => {
    const admin = await asAdmin();
    const first = new Date("2026-01-10T12:00:00Z");
    const post = await createPost({ status: "draft", published: false, publishedAt: first });
    // Mesmo corpo do "Publicar agora" do calendário (PostsService.publishNow)
    await admin.put(`/api/posts/${post._id}`).send({ status: "published", published: true, publishedAt: new Date().toISOString() });
    expect((await BlogPost.findById(post._id).lean()).publishedAt.toISOString()).toBe(first.toISOString());
  });

  it("título que não é texto: 422", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/posts").send({ title: { $gt: "" }, category: "tecnologia" });
    expect(res.status).toBe(422);
  });

  it("conteúdo que não é texto: 422", async () => {
    const admin = await asAdmin();
    const post = await createPost();
    const res = await admin.put(`/api/posts/${post._id}`).send({ content: ["<p>a</p>"] });
    expect(res.status).toBe(422);
  });

  it("operador do MongoDB no corpo da edição é ignorado", async () => {
    const admin = await asAdmin();
    const post = await createPost({ views: 5 });
    const res = await admin.put(`/api/posts/${post._id}`).send({ title: "Título novo", $inc: { views: 1000 } });
    expect(res.status).toBe(200);
    expect((await BlogPost.findById(post._id).lean()).views).toBe(5);
  });

  it("campos do sistema não são aceitos do painel (métricas, lixeira, vitrine)", async () => {
    const admin = await asAdmin();
    const post = await createPost();
    await admin.put(`/api/posts/${post._id}`).send({
      title: "Título novo",
      views: 999,
      favorites: 999,
      shares: 999,
      commentsCount: 999,
      deletedAt: new Date().toISOString(),
      pinnedOrder: 1,
      highlight: "force",
    });
    const saved = await BlogPost.findById(post._id).lean();
    expect(saved.title).toBe("Título novo");
    expect(saved).toMatchObject({ views: 0, favorites: 0, shares: 0, commentsCount: 0, deletedAt: null, pinnedOrder: null });
    expect(saved.highlight).toBe("auto");
  });

  it("remover imagem com objeto no lugar da URL não apaga a galeria inteira", async () => {
    const admin = await asAdmin();
    const post = await createPost({ gallery: [{ url: "https://img/a.webp" }, { url: "https://img/b.webp" }] });
    const res = await admin.delete(`/api/posts/${post._id}/images`).send({ imageUrl: { $ne: null } });
    expect(res.status).toBe(422);
    expect((await BlogPost.findById(post._id).lean()).gallery).toHaveLength(2);
  });

  it("remover imagem com URL texto continua funcionando", async () => {
    const admin = await asAdmin();
    const post = await createPost({ gallery: [{ url: "https://img/a.webp" }, { url: "https://img/b.webp" }] });
    const res = await admin.delete(`/api/posts/${post._id}/images`).send({ imageUrl: "https://img/a.webp" });
    expect(res.status).toBe(200);
    expect((await BlogPost.findById(post._id).lean()).gallery.map((g) => g.url)).toEqual(["https://img/b.webp"]);
  });
});

describe("assinantes", () => {
  it("cadastro manual com email que não é texto: 422", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/subscribers/manual").send({ email: { $ne: null } });
    expect(res.status).toBe(422);
  });

  it("cadastro manual com categorias que não são lista: 422", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/subscribers/manual").send({ email: "a@b.com", categories: "tecnologia" });
    expect(res.status).toBe(422);
  });

  it("editar com categorias que não são lista: 422", async () => {
    const admin = await asAdmin();
    const sub = await Subscriber.create({ email: "a@b.com" });
    const res = await admin.patch(`/api/subscribers/${sub._id}`).send({ categories: "tecnologia" });
    expect(res.status).toBe(422);
  });

  it("editar com nome que não é texto: 422", async () => {
    const admin = await asAdmin();
    const sub = await Subscriber.create({ email: "a@b.com" });
    const res = await admin.patch(`/api/subscribers/${sub._id}`).send({ name: { first: "x" } });
    expect(res.status).toBe(422);
  });
});

describe("envios", () => {
  it("público com categorias que não são lista: 422", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/campaigns").send({ subject: "Oi", audience: { type: "categories", categories: "tecnologia" } });
    expect(res.status).toBe(422);
  });

  it("público com assinantes que não são lista: 422", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/campaigns").send({ subject: "Oi", audience: { type: "selected", subscribers: "abc" } });
    expect(res.status).toBe(422);
  });

  it("contagem de público com tipo errado responde 0, sem erro", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/campaigns/audience-count").send({ audience: { type: "lists", lists: "x" } });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});
