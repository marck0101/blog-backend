import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";
import { api, asAdmin, createPost, models, transporter } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const { forgetPublic } = require("../../app/routes/settings.routes");

const { Subscriber, Suggestion, SiteSettings } = models;

// A leitura dos recursos guarda 30 s na memória; o banco é limpo entre testes
beforeEach(() => forgetPublic());

const valid = (overrides = {}) => ({
  kind: "topic",
  category: "tecnologia",
  message: "Fala sobre Core Web Vitals em sites pequenos",
  name: "Ana Souza",
  email: "ana@x.dev",
  ...overrides,
});

const published = { status: "published", published: true, publishedAt: new Date() };

// Seção 19 do SISTEMA.md (R-SUG-01 a R-SUG-07)
describe("caixinha de sugestões: envio público", () => {
  it("guarda a sugestão como nova e privada, sem exigir assinatura", async () => {
    const res = await api().post("/api/suggestions").send(valid());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "Sugestão recebida. Obrigado!" });

    const saved = await Suggestion.findOne({ email: "ana@x.dev" }).lean();
    expect(saved).toMatchObject({ status: "new", isPublic: false, subscribed: false, subscriber: null, allowName: false });
    expect(await Subscriber.countDocuments()).toBe(0);
  });

  it("R-SUG-02: marcar 'quero assinar' inscreve com todos os temas e liga a sugestão ao cadastro", async () => {
    const res = await api().post("/api/suggestions").send(valid({ subscribe: true, sourcePath: "/blog/um-post" }));
    expect(res.status).toBe(201);

    const sub = await Subscriber.findOne({ email: "ana@x.dev" }).lean();
    expect(sub.status).toBe("active");
    expect(sub.categories.length).toBeGreaterThan(1);
    expect(sub.source).toMatchObject({ location: "suggestion", path: "/blog/um-post" });

    const saved = await Suggestion.findOne({ email: "ana@x.dev" }).lean();
    expect(saved.subscribed).toBe(true);
    expect(String(saved.subscriber)).toBe(String(sub._id));
  });

  it("assinante ativo não é alterado, e a resposta é a mesma (não revela quem assina)", async () => {
    const sub = await Subscriber.create({ email: "ana@x.dev", categories: ["design"] });
    const res = await api().post("/api/suggestions").send(valid({ subscribe: true }));
    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Sugestão recebida. Obrigado!");
    expect((await Subscriber.findById(sub._id).lean()).categories).toEqual(["design"]);
    // Mesmo sem marcar a caixa, a sugestão aparece ligada a quem já assina
    await api().post("/api/suggestions").send(valid({ message: "Outra ideia de assunto aqui" }));
    const second = await Suggestion.findOne({ message: "Outra ideia de assunto aqui" }).lean();
    expect(String(second.subscriber)).toBe(String(sub._id));
  });

  it("avisa o autor do blog por email", async () => {
    process.env.GMAIL_USER = "blog@x.dev";
    try {
      await api().post("/api/suggestions").send(valid());
      expect(transporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringContaining("Nova sugestão") }));
    } finally {
      process.env.GMAIL_USER = "";
    }
  });

  it("recusa assunto que não é categoria, texto curto e email inválido", async () => {
    expect((await api().post("/api/suggestions").send(valid({ category: "culinaria" }))).status).toBe(422);
    expect((await api().post("/api/suggestions").send(valid({ message: "oi" }))).status).toBe(422);
    expect((await api().post("/api/suggestions").send(valid({ email: "nao-e-email" }))).status).toBe(422);
    expect((await api().post("/api/suggestions").send(valid({ kind: "x" }))).status).toBe(422);
    expect(await Suggestion.countDocuments()).toBe(0);
  });

  it("robô que preenche o campo escondido recebe sucesso e nada é guardado", async () => {
    const res = await api().post("/api/suggestions").send(valid({ website: "http://spam.example", subscribe: true }));
    expect(res.status).toBe(201);
    expect(await Suggestion.countDocuments()).toBe(0);
    expect(await Subscriber.countDocuments()).toBe(0);
  });

  it("R-SUG-03: 3 sugestões por IP por hora", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await api().post("/api/suggestions").send(valid({ message: `Ideia número ${i} para o blog` }))).status).toBe(201);
    }
    const blocked = await api().post("/api/suggestions").send(valid());
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("R-SUG-01: com a caixinha desligada em Recursos, recusa", async () => {
    await SiteSettings.create({ key: "site", features: { suggestions: false } });
    const res = await api().post("/api/suggestions").send(valid());
    expect(res.status).toBe(403);
    expect(await Suggestion.countDocuments()).toBe(0);
  });

  it("operador do MongoDB no corpo não passa", async () => {
    const res = await api().post("/api/suggestions").send(valid({ email: { $ne: null } }));
    expect(res.status).toBe(422);
  });
});

describe("caixinha de sugestões: painel", () => {
  it("só o admin lista; contagem por status e o selo de novas", async () => {
    await Suggestion.create({ category: "design", message: "Uma ideia nova", email: "a@x.dev" });
    await Suggestion.create({ category: "design", message: "Outra arquivada", email: "b@x.dev", status: "archived" });

    expect((await api().get("/api/suggestions/admin")).status).toBe(401);

    const admin = await asAdmin();
    const res = await admin.get("/api/suggestions/admin?status=new");
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toHaveLength(1);
    expect(res.body.counts).toEqual({ new: 1, planned: 0, done: 0, archived: 1 });
    expect((await admin.get("/api/suggestions/admin/new-count")).body).toEqual({ count: 1 });
  });

  it("R-SUG-04: atendida precisa do post que a atendeu", async () => {
    const admin = await asAdmin();
    const s = await Suggestion.create({ category: "design", message: "Uma ideia nova", email: "a@x.dev" });
    const res = await admin.patch(`/api/suggestions/admin/${s._id}`).send({ status: "done" });
    expect(res.status).toBe(422);
    expect((await Suggestion.findById(s._id).lean()).status).toBe("new");
  });

  it("R-SUG-05: pública só atendida, com post publicado e texto público; o blog nunca vê email nem texto original", async () => {
    const admin = await asAdmin();
    const draft = await createPost({ title: "Rascunho" });
    const live = await createPost({ title: "Post no ar", slug: "post-no-ar", ...published });
    const s = await Suggestion.create({ category: "tecnologia", message: "Texto original com meu telefone 9999", email: "ana@x.dev", name: "Ana Souza", allowName: true });
    const url = `/api/suggestions/admin/${s._id}`;

    expect((await admin.patch(url).send({ isPublic: true })).status).toBe(422);
    expect((await admin.patch(url).send({ status: "done", post: String(draft._id), isPublic: true, publicText: "Core Web Vitals" })).status).toBe(422);
    expect((await admin.patch(url).send({ status: "done", post: String(live._id), isPublic: true })).status).toBe(422);

    const ok = await admin.patch(url).send({ status: "done", post: String(live._id), publicText: "Core Web Vitals em sites pequenos", isPublic: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "done", isPublic: true });
    expect(ok.body.doneAt).toBeTruthy();

    const pub = await api().get("/api/suggestions/public");
    expect(pub.status).toBe(200);
    expect(pub.body.suggestions).toEqual([
      expect.objectContaining({ text: "Core Web Vitals em sites pequenos", by: "Ana", post: { title: "Post no ar", slug: "post-no-ar" } }),
    ]);
    const raw = JSON.stringify(pub.body);
    expect(raw).not.toContain("ana@x.dev");
    expect(raw).not.toContain("9999");
    expect(pub.headers["cache-control"]).toContain("s-maxage");
  });

  it("sem autorização para o nome, aparece sem nome; post despublicado tira do blog", async () => {
    const admin = await asAdmin();
    const live = await createPost({ title: "Post no ar", ...published });
    const s = await Suggestion.create({ category: "tecnologia", message: "Uma ideia qualquer", email: "a@x.dev", name: "Bruno" });
    await admin.patch(`/api/suggestions/admin/${s._id}`).send({ status: "done", post: String(live._id), publicText: "Ideia", isPublic: true });

    expect((await api().get("/api/suggestions/public")).body.suggestions[0].by).toBeNull();

    await models.BlogPost.updateOne({ _id: live._id }, { published: false, status: "draft" });
    expect((await api().get("/api/suggestions/public")).body.suggestions).toEqual([]);
  });

  it("voltar de atendida tira do blog sozinha", async () => {
    const admin = await asAdmin();
    const live = await createPost({ ...published });
    const s = await Suggestion.create({ category: "tecnologia", message: "Uma ideia qualquer", email: "a@x.dev" });
    const url = `/api/suggestions/admin/${s._id}`;
    await admin.patch(url).send({ status: "done", post: String(live._id), publicText: "Ideia", isPublic: true });
    const back = await admin.patch(url).send({ status: "planned" });
    expect(back.body).toMatchObject({ status: "planned", isPublic: false, doneAt: null });
  });

  it("R-SUG-07: avisa a pessoa uma vez só quando vira post", async () => {
    process.env.GMAIL_USER = "blog@x.dev";
    try {
      const admin = await asAdmin();
      const live = await createPost({ title: "Saiu o post", ...published });
      const s = await Suggestion.create({ category: "tecnologia", message: "Uma ideia qualquer", email: "ana@x.dev" });
      const url = `/api/suggestions/admin/${s._id}`;

      const first = await admin.patch(url).send({ status: "done", post: String(live._id), notify: true });
      expect(first.body.notified).toBe(true);
      expect(transporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "ana@x.dev", subject: expect.stringContaining("Saiu o post") }));

      transporter.sendMail.mockClear();
      const again = await admin.patch(url).send({ notes: "ok", notify: true });
      expect(again.body.notified).toBe(false);
      expect(transporter.sendMail).not.toHaveBeenCalled();
    } finally {
      process.env.GMAIL_USER = "";
    }
  });

  it("R-SUG-06: excluir é definitivo; excluir o assinante só desfaz o vínculo", async () => {
    const admin = await asAdmin();
    const sub = await Subscriber.create({ email: "ana@x.dev" });
    const keep = await Suggestion.create({ category: "design", message: "Ideia que fica", email: "ana@x.dev", subscriber: sub._id });
    const gone = await Suggestion.create({ category: "design", message: "Ideia que sai", email: "ana@x.dev" });

    expect((await admin.delete(`/api/suggestions/admin/${gone._id}`)).status).toBe(200);
    expect(await Suggestion.exists({ _id: gone._id })).toBeNull();
    expect((await admin.delete(`/api/suggestions/admin/${gone._id}`)).status).toBe(404);

    await admin.delete(`/api/subscribers/${sub._id}`);
    expect((await Suggestion.findById(keep._id).lean()).subscriber).toBeNull();
  });

  it("sem login não altera nem exclui", async () => {
    const s = await Suggestion.create({ category: "design", message: "Uma ideia nova", email: "a@x.dev" });
    expect([401, 403]).toContain((await api().patch(`/api/suggestions/admin/${s._id}`).send({ status: "archived" })).status);
    expect([401, 403]).toContain((await api().delete(`/api/suggestions/admin/${s._id}`)).status);
  });
});
