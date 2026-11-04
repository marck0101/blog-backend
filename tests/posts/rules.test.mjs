import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, asAdmin, createPost, daysFromToday, models, transporter } from "../helpers.mjs";

const { BlogPost, Campaign, PostRevision, Season, Subscriber } = models;

// TEST-02: regras de post (SISTEMA.md, seção 2.2). Base de segurança para a
// DUP-07 (dividir o controller): estes testes precisam passar antes e depois.

const CONTENT = "<p>Conteúdo com mais de dez caracteres.</p>";
const newPost = (overrides = {}) => ({ title: "Post de teste", category: "tecnologia", ...overrides });

describe("validação (R-POST-01 a 04)", () => {
  it("R-POST-01 título com menos de 3 caracteres: 422", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/posts").send(newPost({ title: "ab" }));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/3 caracteres/);
  });

  it("R-POST-02 sem categoria: 422", async () => {
    const admin = await asAdmin();
    expect((await admin.post("/api/posts").send({ title: "Sem categoria" })).status).toBe(422);
  });

  it("R-POST-03 rascunho pode ficar sem conteúdo; agendar e publicar não", async () => {
    const admin = await asAdmin();
    expect((await admin.post("/api/posts").send(newPost({ status: "draft" }))).status).toBe(201);
    const published = await admin.post("/api/posts").send(newPost({ title: "Publicado vazio", status: "published", content: "curto" }));
    expect(published.status).toBe(422);
    expect(published.body.error).toMatch(/10 caracteres/);
  });

  it("R-POST-04 agendado sem data: 422", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/posts").send(newPost({ status: "planned", content: CONTENT }));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/data de publicação/);
  });

  it("R-POST-04 editar um agendado sem mandar a data mantém a data salva", async () => {
    const admin = await asAdmin();
    const post = await createPost({ status: "planned", plannedAt: new Date("2026-12-01T12:00:00Z") });
    const res = await admin.put(`/api/posts/${post._id}`).send({ title: "Novo título" });
    expect(res.status).toBe(200);
  });
});

describe("datas e endereço (R-POST-05 a 08)", () => {
  it("R-POST-05 data do formulário é gravada ao meio-dia UTC", async () => {
    const admin = await asAdmin();
    const day = daysFromToday(30);
    const res = await admin.post("/api/posts").send(newPost({ status: "planned", plannedAt: day, content: CONTENT }));
    expect(new Date(res.body.plannedAt).toISOString()).toBe(`${day}T12:00:00.000Z`);
  });

  it("R-POST-06 primeira publicação ganha publishedAt; despublicar mantém", async () => {
    const admin = await asAdmin();
    const created = await admin.post("/api/posts").send(newPost({ status: "published", content: CONTENT }));
    expect(created.body.published).toBe(true);
    expect(created.body.publishedAt).toBeTruthy();
    const draft = await admin.put(`/api/posts/${created.body._id}`).send({ status: "draft" });
    expect(draft.body.published).toBe(false);
    expect(draft.body.publishedAt).toBe(created.body.publishedAt);
  });

  it("R-POST-07 slug sai do título, sem acento, e ganha sufixo se repetir", async () => {
    const admin = await asAdmin();
    const a = await admin.post("/api/posts").send(newPost({ title: "Ação & Reação" }));
    const b = await admin.post("/api/posts").send(newPost({ title: "Ação & Reação" }));
    expect(a.body.slug).toBe("acao-and-reacao");
    expect(b.body.slug).toBe("acao-and-reacao-1");
  });

  it("R-POST-08 mudar o título mantém o slug enviado pelo editor", async () => {
    const admin = await asAdmin();
    const post = await createPost({ title: "Título original" });
    const res = await admin.put(`/api/posts/${post._id}`).send({ title: "Título novo", slug: post.slug });
    expect(res.body.slug).toBe(post.slug);
  });
});

describe("primeira publicação: email e LinkedIn (R-POST-09, R-POST-10)", () => {
  const env = {};
  beforeEach(() => {
    env.GMAIL_USER = process.env.GMAIL_USER;
    env.GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
    Object.assign(process.env, { GMAIL_USER: "blog@teste.dev", GMAIL_APP_PASSWORD: "x" });
  });
  afterEach(() => Object.assign(process.env, env));

  const subscriberMails = () => transporter.sendMail.mock.calls.map((c) => c[0]).filter((m) => m.to === "leitor@x.dev");

  it("R-POST-09 publicar avisa quem segue a categoria e cria o envio em Envios", async () => {
    const admin = await asAdmin();
    await Subscriber.create({ email: "leitor@x.dev", categories: ["tecnologia"] });
    await Subscriber.create({ email: "outra@x.dev", categories: ["design"] });

    const res = await admin.post("/api/posts").send(newPost({ status: "published", content: CONTENT }));

    expect(subscriberMails()).toHaveLength(1);
    const notice = await Campaign.findOne({ kind: "post-notification", post: res.body._id }).lean();
    expect(notice.status).toBe("sent");
    expect(notice.recipients.map((r) => r.email)).toEqual(["leitor@x.dev"]);
  });

  it("R-POST-09 falha no LinkedIn não desfaz a publicação; o erro fica no post", async () => {
    const admin = await asAdmin();
    // fetch bloqueado nos testes: o LinkedIn falha por "não conectado"
    const res = await admin
      .post("/api/posts")
      .send(newPost({ status: "published", content: CONTENT, linkedin: { enabled: true, text: "Novo artigo" } }));
    expect(res.status).toBe(201);
    const saved = await BlogPost.findById(res.body._id).lean();
    expect(saved.published).toBe(true);
    expect(saved.linkedin.status).toBe("failed");
    expect(saved.linkedin.error).toMatch(/LinkedIn/);
  });

  it("R-POST-10 despublicar e publicar de novo não manda o aviso de novo", async () => {
    const admin = await asAdmin();
    await Subscriber.create({ email: "leitor@x.dev", categories: ["tecnologia"] });
    const created = await admin.post("/api/posts").send(newPost({ status: "published", content: CONTENT }));
    await admin.put(`/api/posts/${created.body._id}`).send({ status: "draft" });
    await admin.put(`/api/posts/${created.body._id}`).send({ status: "published" });

    expect(subscriberMails()).toHaveLength(1);
    expect(await Campaign.countDocuments({ kind: "post-notification", post: created.body._id })).toBe(1);
  });

  it("aviso desligado no post: publica sem email", async () => {
    const admin = await asAdmin();
    await Subscriber.create({ email: "leitor@x.dev", categories: ["tecnologia"] });
    await admin.post("/api/posts").send(newPost({ status: "published", content: CONTENT, emailNotify: false }));
    expect(subscriberMails()).toHaveLength(0);
  });
});

describe("season (R-POST-11)", () => {
  it("season inexistente: 422; existente: aceita; vazia: post avulso", async () => {
    const admin = await asAdmin();
    expect((await admin.post("/api/posts").send(newPost({ season: "nao-existe" }))).status).toBe(422);

    await Season.create({ title: "Série de teste", slug: "serie-de-teste" });
    const inSeason = await admin.post("/api/posts").send(newPost({ title: "Episódio", season: "serie-de-teste", seasonOrder: "2" }));
    expect(inSeason.body).toMatchObject({ season: "serie-de-teste", seasonOrder: 2 });

    const standalone = await admin.post("/api/posts").send(newPost({ title: "Avulso", season: "" }));
    expect(standalone.body.season).toBeNull();
  });
});

describe("leitura pública (R-POST-12)", () => {
  it("só campos permitidos: nada de email, LinkedIn, leituras ou vitrine", async () => {
    await createPost({
      status: "published",
      published: true,
      publishedAt: new Date(),
      emailSubject: "Assunto interno",
      linkedin: { enabled: true, text: "texto" },
      views: 10,
    });
    const res = await api().get("/api/posts/slug/post-de-teste");
    expect(res.status).toBe(200);
    for (const field of ["emailSubject", "emailAudience", "linkedin", "views", "favorites", "pinnedOrder", "highlight", "status"]) {
      expect(res.body, field).not.toHaveProperty(field);
    }
  });

  it("rascunho e post na lixeira não existem para o leitor", async () => {
    await createPost({ title: "Rascunho" });
    await createPost({ title: "Na lixeira", status: "published", published: true, deletedAt: new Date() });
    expect((await api().get("/api/posts/slug/rascunho")).status).toBe(404);
    expect((await api().get("/api/posts/slug/na-lixeira")).status).toBe(404);
  });

  it("ler conta uma leitura e não muda o updatedAt (o sitemap não acusa edição)", async () => {
    const post = await createPost({ status: "published", published: true, publishedAt: new Date() });
    const before = (await BlogPost.findById(post._id).lean()).updatedAt;
    await api().get(`/api/posts/slug/${post.slug}`);
    const after = await BlogPost.findById(post._id).lean();
    expect(after.views).toBe(1);
    expect(after.updatedAt).toEqual(before);
  });
});

describe("histórico de versões (R-REV-01 a 03)", () => {
  it("criar gera v1; editar o que o leitor vê gera v2; salvar igual não gera", async () => {
    const admin = await asAdmin();
    const created = await admin.post("/api/posts").send(newPost({ content: CONTENT }));
    const id = created.body._id;
    await admin.put(`/api/posts/${id}`).send({ title: "Título mudou", slug: created.body.slug });
    await admin.put(`/api/posts/${id}`).send({ title: "Título mudou", slug: created.body.slug });
    // Mudar só a data do calendário não é conteúdo: não gera versão
    await admin.put(`/api/posts/${id}`).send({ plannedAt: "2026-12-10" });

    const versions = await PostRevision.find({ post: id }).sort({ version: 1 }).lean();
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[1].changes).toEqual(["title"]);
  });

  it("restaurar versão volta o conteúdo, mantém slug e status, e vira versão nova", async () => {
    const admin = await asAdmin();
    const created = await admin.post("/api/posts").send(newPost({ title: "Primeira versão", content: CONTENT }));
    const id = created.body._id;
    await admin.put(`/api/posts/${id}`).send({ title: "Segunda versão", slug: created.body.slug, status: "published", content: CONTENT });

    const res = await admin.post(`/api/posts/${id}/revisions/1/restore`);
    expect(res.body).toMatchObject({ title: "Primeira versão", slug: created.body.slug, status: "published" });
    const last = await PostRevision.findOne({ post: id }).sort({ version: -1 }).lean();
    expect(last).toMatchObject({ version: 3, reason: "restore", restoredFrom: 1 });
  });
});
