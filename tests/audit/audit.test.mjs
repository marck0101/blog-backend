import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_ORIGIN, api, asAdmin, createAdmin, createPost, models, sign } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const AdminAuditLog = require("../../app/models/adminAuditLog.model");
const audit = require("../../app/services/audit.service");
const { Campaign, Subscriber, BlogPost, Season } = models;
const { generateSecret, codeAt, currentStep } = require("../../app/utils/totp");
const { seal } = require("../../app/utils/secretBox");

// SEC-09 (R-AUD-*): registro de ações do admin
const entries = (filter = {}) => AdminAuditLog.find(filter).sort({ at: 1 }).lean();
const CONTENT = "<p>Conteúdo com mais de dez caracteres.</p>";

describe("registro de ações: posts", () => {
  it("publicar ao criar e tirar do ar ao editar", async () => {
    const admin = await asAdmin();
    const created = await admin
      .post("/api/posts")
      .set("User-Agent", "Mozilla/5.0 teste")
      .send({ title: "Post no ar", content: CONTENT, category: "tecnologia", status: "published" });
    expect(created.status).toBe(201);

    const [pub] = await entries();
    expect(pub.action).toBe("post.publish");
    expect(pub.actor).toEqual({ userId: String(admin.user._id), email: "admin@teste.dev" });
    expect(pub.target).toMatchObject({ type: "post", id: created.body._id, label: created.body.slug });
    expect(pub.ipHash).toMatch(/^[a-f0-9]{16}$/);
    expect(pub.userAgent).toBe("Mozilla/5.0 teste");
    expect(pub.at).toBeInstanceOf(Date);

    const back = await admin
      .put(`/api/posts/${created.body._id}`)
      .send({ title: "Post no ar", content: CONTENT, category: "tecnologia", status: "draft" });
    expect(back.status).toBe(200);
    expect((await entries()).map((e) => e.action)).toEqual(["post.publish", "post.unpublish"]);
  });

  it("editar post publicado sem mudar o status não registra nada", async () => {
    const admin = await asAdmin();
    const post = await createPost({ status: "published", published: true, publishedAt: new Date() });
    const res = await admin
      .put(`/api/posts/${post._id}`)
      .send({ title: "Novo título", content: CONTENT, category: "tecnologia", status: "published" });
    expect(res.status).toBe(200);
    expect(await entries()).toHaveLength(0);
  });

  it("lixeira, restaurar e excluir de vez", async () => {
    const admin = await asAdmin();
    const post = await createPost();
    await admin.delete(`/api/posts/${post._id}`);
    await admin.patch(`/api/posts/${post._id}/restore`);
    await admin.delete(`/api/posts/${post._id}`);
    await admin.delete(`/api/posts/${post._id}/hard`);
    const list = await entries();
    expect(list.map((e) => e.action)).toEqual(["post.trash", "post.restore", "post.trash", "post.delete_permanent"]);
    expect(list.every((e) => e.target.id === String(post._id) && e.target.label === post.slug)).toBe(true);
  });

  it("ação recusada (404, 409) não registra", async () => {
    const admin = await asAdmin();
    const post = await createPost();
    expect((await admin.delete(`/api/posts/${post._id}/hard`)).status).toBe(409);
    expect((await admin.delete(`/api/posts/${"a".repeat(24)}`)).status).toBe(404);
    expect(await entries()).toHaveLength(0);
  });
});

describe("registro de ações: envios", () => {
  const env = {};
  beforeEach(() => {
    env.GMAIL_USER = process.env.GMAIL_USER;
    env.GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
    Object.assign(process.env, { GMAIL_USER: "blog@teste.dev", GMAIL_APP_PASSWORD: "x" });
  });
  afterEach(() => Object.assign(process.env, env));

  it("envio registra o tamanho do público, sem emails, e só no primeiro lote", async () => {
    const admin = await asAdmin();
    const sub = await Subscriber.create({ email: "leitor@x.dev" });
    const draft = await Campaign.create({
      subject: "Novidade",
      content: "<p>Olá</p>",
      audience: { type: "selected", subscribers: [sub._id] },
    });
    await admin.post(`/api/campaigns/${draft._id}/send`);
    await admin.post(`/api/campaigns/${draft._id}/send`);
    const list = await entries();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ action: "campaign.send", meta: { audienceSize: 1 } });
    expect(list[0].target).toMatchObject({ type: "campaign", id: String(draft._id), label: "Novidade" });
    expect(JSON.stringify(list)).not.toContain("leitor@x.dev");
  });

  it("reenviar falhas registra quantas", async () => {
    const admin = await asAdmin();
    const sub = await Subscriber.create({ email: "leitor@x.dev" });
    const sent = await Campaign.create({
      subject: "Já enviado",
      content: "<p>Olá</p>",
      status: "sent",
      audience: { type: "selected", subscribers: [sub._id] },
      recipients: [{ subscriber: sub._id, email: sub.email, status: "failed", error: "x" }],
    });
    const res = await admin.post(`/api/campaigns/${sent._id}/retry-failed`);
    expect(res.status).toBe(200);
    const [e] = await entries();
    expect(e).toMatchObject({ action: "campaign.retry", meta: { failed: 1 } });
  });
});

describe("registro de ações: assinantes e seasons", () => {
  it("mudar plano ou status registra só o id (nunca o email)", async () => {
    const admin = await asAdmin();
    const sub = await Subscriber.create({ email: "pessoa@privado.dev", name: "Pessoa Privada" });
    await admin.patch(`/api/subscribers/${sub._id}`).send({ tier: "member" });
    await admin.patch(`/api/subscribers/${sub._id}`).send({ status: "unsubscribed" });
    await admin.patch(`/api/subscribers/${sub._id}`).send({ notes: "só uma nota" }); // não é plano nem status
    const list = await entries();
    expect(list.map((e) => e.action)).toEqual(["subscriber.update", "subscriber.update"]);
    expect(list[0].meta).toEqual({ tier: "member" });
    expect(list[1].meta).toEqual({ status: "unsubscribed" });
    expect(list[0].target).toMatchObject({ type: "subscriber", id: String(sub._id), label: null });
    const raw = JSON.stringify(list);
    expect(raw).not.toContain("pessoa@privado.dev");
    expect(raw).not.toContain("Pessoa Privada");
  });

  it("excluir assinante de vez registra só o id", async () => {
    const admin = await asAdmin();
    const sub = await Subscriber.create({ email: "apagar@privado.dev" });
    await admin.delete(`/api/subscribers/${sub._id}`);
    const [e] = await entries();
    expect(e).toMatchObject({ action: "subscriber.delete", target: { type: "subscriber", id: String(sub._id), label: null } });
    expect(JSON.stringify(e)).not.toContain("apagar@privado.dev");
  });

  it("excluir season", async () => {
    const admin = await asAdmin();
    const season = await Season.create({ title: "Season Vazia", slug: "season-vazia" });
    const res = await admin.delete(`/api/seasons/${season._id}`);
    expect(res.status).toBe(200);
    const [e] = await entries();
    expect(e).toMatchObject({ action: "season.delete", target: { type: "season", id: String(season._id), label: "season-vazia" } });
  });
});

describe("registro de ações: LinkedIn", () => {
  it("publicação manual no LinkedIn", async () => {
    const admin = await asAdmin();
    const post = await createPost({ status: "published", published: true, publishedAt: new Date() });
    const linkedin = require("../../app/services/linkedin.service");
    vi.spyOn(linkedin, "retryShare").mockResolvedValue({ status: "posted" });
    const res = await admin.post(`/api/linkedin/posts/${post._id}/share`).send({});
    expect(res.status).toBe(200);
    const [e] = await entries();
    expect(e).toMatchObject({ action: "linkedin.share", target: { type: "post", id: String(post._id) } });
  });
});

describe("registro de ações: login", () => {
  const PASSWORD = "senha-correta-123";
  const login = (body) => api().post("/api/auth/login").set("Origin", PANEL_ORIGIN).send(body);

  it("senha errada registra falha sem guardar o email nem a senha", async () => {
    const bcrypt = require("bcryptjs");
    await createAdmin({ password: await bcrypt.hash(PASSWORD, 4) });
    const res = await login({ email: "admin@teste.dev", password: "errada-errada" });
    expect(res.status).toBe(401);
    const [e] = await entries();
    expect(e).toMatchObject({ action: "auth.login_failure", actor: { userId: null, email: null }, meta: { method: "password", reason: "credenciais" } });
    const raw = JSON.stringify(e);
    expect(raw).not.toContain("admin@teste.dev");
    expect(raw).not.toContain("errada-errada");
  });

  it("código do 2º fator errado registra falha; certo registra o login", async () => {
    const secret = generateSecret();
    const user = await createAdmin({ mfa: { enabledAt: new Date(), secret: seal(secret), lastStep: -1 } });
    const pending = `admin_pending=${sign({ id: user._id, stage: "mfa", method: "google", v: 0 }, "10m")}`;
    const verify = (code) => api().post("/api/auth/2fa/verify").set("Origin", PANEL_ORIGIN).set("Cookie", pending).send({ code });

    expect((await verify("000000")).status).toBe(401);
    const good = await verify(codeAt(secret, currentStep()));
    expect(good.status).toBe(200);

    const list = await entries();
    expect(list.map((e) => e.action)).toEqual(["auth.login_failure", "auth.login_success"]);
    expect(list[0].meta).toEqual({ method: "google", reason: "codigo_2fa" });
    expect(list[1].actor).toEqual({ userId: String(user._id), email: "admin@teste.dev" });
    expect(list[1].meta).toEqual({ method: "google", recovery: false });
  });
});

describe("serviço audit.record", () => {
  it("falha ao gravar não lança nem derruba a ação", async () => {
    vi.spyOn(AdminAuditLog, "create").mockRejectedValue(new Error("banco fora"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(audit.record({ headers: {} }, "post.trash", { type: "post", id: "1" })).resolves.toBeUndefined();

    const admin = await asAdmin();
    const post = await createPost();
    const res = await admin.delete(`/api/posts/${post._id}`);
    expect(res.status).toBe(200);
    expect((await BlogPost.findById(post._id).lean()).deletedAt).not.toBeNull();
  });

  it("meta descarta chaves sensíveis, valores complexos e limita o tamanho", async () => {
    await audit.record(
      { headers: { "user-agent": "x".repeat(500) } },
      "post.trash",
      { type: "post", id: 7, label: "y".repeat(500) },
      { ok: 1, token: "abc", email: "a@b.c", password: "p", nested: { a: 1 }, long: "z".repeat(500) }
    );
    const [e] = await entries();
    expect(Object.keys(e.meta).sort()).toEqual(["long", "ok"]);
    expect(e.meta.long).toHaveLength(80);
    expect(e.userAgent).toHaveLength(120);
    expect(e.target.label).toHaveLength(120);
    expect(e.target.id).toBe("7");
  });

  it("o IP vira hash (nunca é gravado) e é estável para o mesmo IP", async () => {
    const req = { headers: { "x-real-ip": "203.0.113.9" } };
    await audit.record(req, "post.trash");
    await audit.record(req, "post.trash");
    const [a, b] = await entries();
    expect(a.ipHash).toBe(b.ipHash);
    expect(JSON.stringify(a)).not.toContain("203.0.113.9");
  });
});

describe("expiração", () => {
  it("índice TTL de 365 dias em `at`", async () => {
    await AdminAuditLog.init();
    const indexes = await AdminAuditLog.collection.indexes();
    const ttl = indexes.find((i) => i.key.at === 1);
    expect(ttl.expireAfterSeconds).toBe(365 * 24 * 60 * 60);
  });
});

describe("GET /api/admin/audit", () => {
  const seed = async () => {
    const day = (iso) => new Date(`${iso}T15:00:00Z`);
    await AdminAuditLog.create([
      { action: "post.trash", at: day("2026-11-01") },
      { action: "post.restore", at: day("2026-11-05") },
      { action: "post.trash", at: day("2026-11-10") },
      { action: "campaign.send", at: day("2026-11-15") },
    ]);
  };

  it("exige login", async () => {
    expect((await api().get("/api/admin/audit")).status).toBe(401);
  });

  it("lista do mais novo para o mais antigo, com paginação", async () => {
    const admin = await asAdmin();
    await seed();
    const p1 = await admin.get("/api/admin/audit?limit=3");
    expect(p1.status).toBe(200);
    expect(p1.body).toMatchObject({ total: 4, page: 1, totalPages: 2 });
    expect(p1.body.entries.map((e) => e.action)).toEqual(["campaign.send", "post.trash", "post.restore"]);
    const p2 = await admin.get("/api/admin/audit?limit=3&page=2");
    expect(p2.body.entries).toHaveLength(1);
    expect(p2.body.entries[0].action).toBe("post.trash");
  });

  it("filtra por ação e por período", async () => {
    const admin = await asAdmin();
    await seed();
    const byAction = await admin.get("/api/admin/audit?action=post.trash");
    expect(byAction.body.total).toBe(2);
    const byDate = await admin.get("/api/admin/audit?from=2026-11-05&to=2026-11-10");
    expect(byDate.body.entries.map((e) => e.action)).toEqual(["post.trash", "post.restore"]);
    const both = await admin.get("/api/admin/audit?action=post.trash&from=2026-11-05");
    expect(both.body.total).toBe(1);
  });

  it("parâmetros inválidos: 422", async () => {
    const admin = await asAdmin();
    for (const q of ["action=inventada", "from=ontem", "page=0", "limit=1000", "page=abc"]) {
      expect((await admin.get(`/api/admin/audit?${q}`)).status, q).toBe(422);
    }
  });

  it("é só leitura: não há rota para alterar", async () => {
    const admin = await asAdmin();
    expect((await admin.post("/api/admin/audit").send({})).status).toBe(404);
    expect((await admin.delete("/api/admin/audit").send({})).status).toBe(404);
  });
});
