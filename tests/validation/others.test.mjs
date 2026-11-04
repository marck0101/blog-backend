import { describe, expect, it } from "vitest";
import { PANEL_ORIGIN, api, asAdmin, createPost, models, sign } from "../helpers.mjs";

const { Comment, Season } = models;

// VAL-01: públicos, seasons, comentários, login e LinkedIn
describe("públicos", () => {
  it("nome obrigatório; descrição longa demais", async () => {
    const admin = await asAdmin();
    expect((await admin.post("/api/audiences").send({ name: "   " })).body).toEqual({ error: "O nome do público é obrigatório" });
    expect((await admin.post("/api/audiences").send({ name: "Clientes", description: "a".repeat(301) })).status).toBe(422);
    expect((await admin.post("/api/audiences").send({ name: "  Clientes  " })).body.name).toBe("Clientes");
  });

  it("importação: consentimento, lista vazia e linhas que não são objeto", async () => {
    const admin = await asAdmin();
    const list = (await admin.post("/api/audiences").send({ name: "Evento" })).body;
    const url = `/api/audiences/${list._id}/import`;
    expect((await admin.post(url).send({ rows: [{ email: "a@b.dev" }] })).body.error).toMatch(/autorizaram/);
    expect((await admin.post(url).send({ consent: true, rows: [] })).body).toEqual({ error: "A lista está vazia" });
    expect((await admin.post(url).send({ consent: true, rows: ["a@b.dev"] })).status).toBe(422);
    // Uma linha ruim não recusa o arquivo: volta como inválida no resumo
    const ok = await admin.post(url).send({ consent: true, rows: [{ email: "a@b.dev" }, { email: "lixo" }] });
    expect(ok.status).toBe(200);
    expect(ok.body.created).toBe(1);
    expect(ok.body.invalid).toHaveLength(1);
  });
});

describe("seasons", () => {
  it("FAQ: pares incompletos são descartados; ordem inválida vira 0; slug normalizado", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/seasons").send({
      title: "Série nova",
      slug: "Série Nova!",
      order: "abc",
      faq: [{ question: "Completa?", answer: "Sim" }, { question: "Só pergunta", answer: "" }, {}],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ slug: "serie-nova", order: 0, faq: [{ question: "Completa?", answer: "Sim" }] });
  });

  it("título que não é texto: 422", async () => {
    const admin = await asAdmin();
    const season = await Season.create({ title: "Série", slug: "serie" });
    expect((await admin.patch(`/api/seasons/${season._id}`).send({ title: { $ne: null } })).status).toBe(422);
  });
});

describe("comentários", () => {
  const readerCookie = () => `reader_session=${sign({ purpose: "reader", sub: "google-1", name: "Leitor" }, "1h")}`;
  const comment = (postId, body) =>
    api().post(`/api/comments/post/${postId}`).set("Origin", PANEL_ORIGIN).set("Cookie", readerCookie()).send(body);

  it("leitor: texto obrigatório, resposta com id inválido", async () => {
    const post = await createPost({ status: "published", published: true });
    expect((await comment(post._id, {})).body).toEqual({ error: "Escreva o comentário" });
    expect((await comment(post._id, { body: "Oi", parentId: "abc" })).body).toEqual({ error: "Comentário inválido" });
    expect((await comment(post._id, { body: "Ótimo artigo!", parentId: null })).status).toBe(201);
  });

  it("moderação: status fora da lista", async () => {
    const admin = await asAdmin();
    const post = await createPost();
    const c = await Comment.create({ post: post._id, author: { name: "Leitor" }, body: "Oi" });
    expect((await admin.patch(`/api/comments/admin/${c._id}`).send({ status: "spam" })).body).toEqual({ error: "Status inválido" });
  });
});

describe("login (contrato: 400 Dados inválidos)", () => {
  const login = (body) => api().post("/api/auth/login").set("Origin", PANEL_ORIGIN).send(body);

  it.each([[{}], [{ email: { $ne: null }, password: "x" }], [{ email: "a@b.dev", password: ["x"] }], [{ email: "a@b.dev", password: "" }]])(
    "%j → 400",
    async (body) => {
      const res = await login(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Dados inválidos");
    }
  );

  it("esqueci a senha sem email: 400 com motivo", async () => {
    const res = await api().post("/api/auth/forgot-password").set("Origin", PANEL_ORIGIN).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Email é obrigatório");
  });
});

describe("LinkedIn", () => {
  it("publicar de novo: force que não é sim/não é recusado", async () => {
    const admin = await asAdmin();
    const post = await createPost();
    expect((await admin.post(`/api/linkedin/posts/${post._id}/share`).send({ force: "true" })).status).toBe(422);
  });
});
