import { describe, expect, it } from "vitest";
import { PANEL_ORIGIN, api, asAdmin, createPost, models } from "../helpers.mjs";

const { BlogPost } = models;

// VAL-01: formato do post conferido pelo esquema (validation/posts.schemas.js)
const base = { title: "Post válido", category: "design" };

describe("esquema do post", () => {
  it.each([
    ["FAQ com resposta que não é texto", { faq: [{ question: "Pergunta?", answer: { $ne: null } }] }],
    ["galeria que não é lista", { gallery: "https://img/a.webp" }],
    ["imagem da galeria sem URL em texto", { gallery: [{ url: 123 }] }],
    ["público do email com tipo desconhecido", { emailAudience: { type: "todo-mundo" } }],
    ["público com assinante que não é id", { emailAudience: { type: "selected", subscribers: ["abc"] } }],
    ["LinkedIn ligado com texto que não é texto", { linkedin: { enabled: true, text: ["x"] } }],
    ["SEO com descrição que não é texto", { seo: { description: 42 } }],
    ["status desconhecido", { status: "arquivado" }],
    ["emailNotify em texto", { emailNotify: "sim" }],
  ])("%s: 422", async (_, extra) => {
    const admin = await asAdmin();
    const res = await admin.post("/api/posts").send({ ...base, ...extra });
    expect(res.status).toBe(422);
    expect(typeof res.body.error).toBe("string");
  });

  it("limites de tamanho: título, alt da capa, FAQ", async () => {
    const admin = await asAdmin();
    expect((await admin.post("/api/posts").send({ ...base, title: "a".repeat(301) })).body.error).toBe("title: no máximo 300 caracteres");
    expect((await admin.post("/api/posts").send({ ...base, coverImageAlt: "a".repeat(126) })).status).toBe(422);
    expect((await admin.post("/api/posts").send({ ...base, faq: Array(51).fill({ question: "P", answer: "R" }) })).body.error).toBe("faq: no máximo 50 itens");
  });

  it("campo do sistema dentro de objeto aninhado é descartado (linkedin.status)", async () => {
    const admin = await asAdmin();
    const post = await createPost({ status: "published", published: true, linkedin: { enabled: true, status: "failed" } });
    await admin.put(`/api/posts/${post._id}`).send({ linkedin: { text: "Novo texto", status: "posted", postUrn: "urn:falso" } });
    const saved = await BlogPost.findById(post._id).lean();
    expect(saved.linkedin).toMatchObject({ text: "Novo texto", status: "failed", postUrn: "" });
  });

  it("edição parcial continua funcionando (calendário, ação em massa)", async () => {
    const admin = await asAdmin();
    const post = await createPost();
    expect((await admin.put(`/api/posts/${post._id}`).send({ plannedAt: null })).status).toBe(200);
    expect((await admin.put(`/api/posts/${post._id}`).send({ season: null, seasonOrder: null })).status).toBe(200);
    expect((await admin.put(`/api/posts/${post._id}`).send({ status: "draft" })).status).toBe(200);
  });
});

describe("outras rotas de post", () => {
  it("fixar: id que não é id, operador e mais de 3 são recusados", async () => {
    const admin = await asAdmin();
    expect((await admin.put("/api/posts/showcase/pinned").send({ ids: [{ $gt: "" }] })).status).toBe(422);
    expect((await admin.put("/api/posts/showcase/pinned").send({})).body.error).toBe("Envie a lista de posts fixados");
    const ids = Array.from({ length: 4 }, (_, i) => `64b00000000000000000000${i}`);
    expect((await admin.put("/api/posts/showcase/pinned").send({ ids })).body.error).toBe("Fixe no máximo 3 posts");
  });

  it("destaque: só auto, force ou hide", async () => {
    const admin = await asAdmin();
    const post = await createPost();
    const res = await admin.patch(`/api/posts/${post._id}/highlight`).send({ highlight: "sempre" });
    expect(res.body).toEqual({ error: "Opção inválida" });
  });

  it("evento do leitor com tipo que não é texto: 422", async () => {
    const post = await createPost({ status: "published", published: true });
    const res = await api().post(`/api/posts/public/${post._id}/engage`).set("Origin", PANEL_ORIGIN).send({ type: { $ne: null } });
    expect(res.status).toBe(422);
  });
});
