import { afterEach, describe, expect, it, vi } from "vitest";
import { PANEL_ORIGIN, api, asAdmin, createPost, models, sign, transporter } from "../helpers.mjs";

const { BlogPost, Comment } = models;

// TEST-06: comentários (SISTEMA.md, seção 9, R-COM-01 a 08).
// Já coberto em comments/moderate.test.mjs: recusa com motivo (parte do R-COM-02).
// Login com Google em si (troca de código) não é testado: exigiria rede.

const readerToken = (sub = "google-1", extra = {}) =>
  sign({ purpose: "reader", sub, name: "Leitora Teste", email: "leitora@teste.dev", picture: "https://x/p.png", ...extra }, "1h");
const readerCookie = (sub) => `reader_session=${readerToken(sub)}`;

const published = (overrides = {}) => createPost({ status: "published", published: true, publishedAt: new Date(), ...overrides });

// Como o navegador do leitor: origem do blog + cookie de leitor (+ IP opcional)
const send = (postId, body, { sub = "google-1", ip } = {}) => {
  const req = api().post(`/api/comments/post/${postId}`).set("Origin", PANEL_ORIGIN).set("Cookie", readerCookie(sub));
  if (ip) req.set("X-Real-IP", ip);
  return req.send(body);
};

const list = (postId, sub) => {
  const req = api().get(`/api/comments/post/${postId}`);
  if (sub) req.set("Cookie", readerCookie(sub));
  return req;
};

const make = (post, overrides = {}) =>
  Comment.create({ post: post._id, author: { sub: "outro", name: "Outro", email: "outro@teste.dev" }, body: "Texto", ...overrides });

afterEach(() => vi.unstubAllEnvs());

describe("login do leitor (R-COM-01)", () => {
  it("sem login: 401 e nada é gravado", async () => {
    const post = await published();
    const res = await api().post(`/api/comments/post/${post._id}`).set("Origin", PANEL_ORIGIN).send({ body: "Oi" });
    expect(res.status).toBe(401);
    expect(await Comment.countDocuments()).toBe(0);
  });

  it("/me mostra o leitor logado só com nome e foto", async () => {
    const res = await api().get("/api/comments/me").set("Cookie", readerCookie());
    expect(res.body.reader).toEqual({ name: "Leitora Teste", picture: "https://x/p.png" });
  });

  it("token com outra finalidade não vale como leitor", async () => {
    const post = await published();
    const fake = `reader_session=${sign({ sub: "x", name: "X" }, "1h")}`;
    const res = await api().post(`/api/comments/post/${post._id}`).set("Origin", PANEL_ORIGIN).set("Cookie", fake).send({ body: "Oi" });
    expect(res.status).toBe(401);
  });

  it("a sessão do leitor não serve para o painel (e vice-versa)", async () => {
    const asReaderOnPanel = await api()
      .get("/api/comments/admin/pending-count")
      .set("Cookie", [readerCookie(), `admin_session=${readerToken()}`]);
    expect(asReaderOnPanel.status).toBe(401);

    // Sessão do painel não vale como leitor
    const admin = await asAdmin();
    const post = await published();
    const res = await admin.post(`/api/comments/post/${post._id}`).send({ body: "Oi" });
    expect(res.status).toBe(401);
  });

  it("o cookie do leitor dura 30 dias", async () => {
    // Sessão emitida pelo callback do Google (setReaderCookie)
    const { setReaderCookie } = await import("node:module").then((m) => m.createRequire(import.meta.url)("../../app/utils/session"));
    const res = { cookie: vi.fn() };
    setReaderCookie(res, { sub: "s", name: "N", email: "e@x.dev", picture: "" });
    const [name, , options] = res.cookie.mock.calls[0];
    expect(name).toBe("reader_session");
    expect(options.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
    expect(options.httpOnly).toBe(true);
  });
});

describe("pendente até aprovar (R-COM-02)", () => {
  it("entra pendente; o público não vê, o próprio autor vê como pendente", async () => {
    const post = await published();
    const created = await send(post._id, { body: "Meu primeiro comentário" });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("pending");

    const anonymous = await list(post._id);
    expect(anonymous.body.comments).toEqual([]);
    const other = await list(post._id, "google-2");
    expect(other.body.comments).toEqual([]);
    const mine = await list(post._id, "google-1");
    expect(mine.body.comments).toHaveLength(1);
    expect(mine.body.comments[0]).toMatchObject({ status: "pending", mine: true, body: "Meu primeiro comentário" });
  });

  it("depois de aprovado aparece para todos; recusado some para os outros e o autor vê o motivo", async () => {
    const admin = await asAdmin();
    const post = await published();
    const a = await send(post._id, { body: "Vou ser aprovado" });
    const b = await send(post._id, { body: "Vou ser recusado" });

    await admin.patch(`/api/comments/admin/${a.body.id}`).send({ status: "approved" });
    await admin.patch(`/api/comments/admin/${b.body.id}`).send({ status: "rejected", reason: "Fora do tema", notify: false });

    const anonymous = (await list(post._id)).body.comments;
    expect(anonymous.map((c) => c.body)).toEqual(["Vou ser aprovado"]);
    const mine = (await list(post._id, "google-1")).body.comments;
    expect(mine.find((c) => c.status === "rejected")).toMatchObject({ rejectionReason: "Fora do tema" });
    // Os outros leitores não recebem o comentário recusado nem o motivo
    expect((await list(post._id, "google-2")).body.comments.map((c) => c.body)).toEqual(["Vou ser aprovado"]);
  });

  it("aprovar atualiza a contagem de comentários do post; voltar a pendente desconta", async () => {
    const admin = await asAdmin();
    const post = await published();
    const c = await send(post._id, { body: "Contar" });
    expect((await BlogPost.findById(post._id).lean()).commentsCount).toBe(0);

    await admin.patch(`/api/comments/admin/${c.body.id}`).send({ status: "approved" });
    expect((await BlogPost.findById(post._id).lean()).commentsCount).toBe(1);
    await admin.patch(`/api/comments/admin/${c.body.id}`).send({ status: "pending" });
    expect((await BlogPost.findById(post._id).lean()).commentsCount).toBe(0);
  });

  it("post em rascunho ou inexistente não recebe comentário: 404", async () => {
    const draft = await createPost();
    expect((await send(draft._id, { body: "Oi" })).status).toBe(404);
    expect((await send("64b000000000000000000000", { body: "Oi" })).status).toBe(404);
    expect((await list(draft._id)).status).toBe(404);
  });

  it("origem de fora do site: 403", async () => {
    const post = await published();
    const res = await api()
      .post(`/api/comments/post/${post._id}`)
      .set("Origin", "https://evil.example")
      .set("Cookie", readerCookie())
      .send({ body: "Oi" });
    expect(res.status).toBe(403);
  });
});

describe("texto e limites (R-COM-03)", () => {
  it("2000 caracteres passa; 2001 é recusado; menos de 2 também", async () => {
    const post = await published();
    expect((await send(post._id, { body: "a".repeat(2000) })).status).toBe(201);
    const long = await send(post._id, { body: "a".repeat(2001) });
    expect(long.status).toBe(422);
    expect(long.body.error).toMatch(/2000/);
    expect((await send(post._id, { body: "a" })).status).toBe(422);
    expect((await send(post._id, { body: "   " })).status).toBe(422);
  });

  it("texto puro: caracteres de controle saem e linhas em branco em excesso são reduzidas", async () => {
    const post = await published();
    const res = await send(post._id, { body: "Linha 1\u0000\u0007\r\n\r\n\r\n\r\nLinha 2  " });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe("Linha 1\n\nLinha 2");
  });

  it("HTML não é interpretado: fica guardado como texto, sem alteração", async () => {
    const post = await published();
    const res = await send(post._id, { body: "<script>alert(1)</script> oi" });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe("<script>alert(1)</script> oi");
  });

  it("5 comentários por IP a cada 10 min: o 6º recebe 429 com Retry-After", async () => {
    const admin = await asAdmin();
    const post = await published();
    // Aprova a cada um para o limite de pendentes não ser o que barra
    for (let i = 0; i < 5; i++) {
      const res = await send(post._id, { body: `Comentário ${i}` }, { ip: "203.0.113.20" });
      expect(res.status).toBe(201);
      await admin.patch(`/api/comments/admin/${res.body.id}`).send({ status: "approved" });
    }
    const blocked = await send(post._id, { body: "Comentário 6" }, { ip: "203.0.113.20" });
    expect(blocked.status).toBe(429);
    const retry = Number(blocked.headers["retry-after"]);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(10 * 60);
    expect(await Comment.countDocuments()).toBe(5);

    // Outro IP (e outra pessoa) segue livre
    expect((await send(post._id, { body: "De outro IP" }, { sub: "google-9", ip: "203.0.113.21" })).status).toBe(201);
  });

  it("comentário recusado por texto inválido não gasta o limite de IP", async () => {
    const post = await published();
    for (let i = 0; i < 6; i++) expect((await send(post._id, { body: "a" }, { ip: "203.0.113.22" })).status).toBe(422);
    expect((await send(post._id, { body: "Agora vale" }, { ip: "203.0.113.22" })).status).toBe(201);
  });

  it("no máximo 5 pendentes por pessoa: o 6º recebe 429 (mesmo com IPs diferentes)", async () => {
    const post = await published();
    for (let i = 0; i < 5; i++) {
      expect((await send(post._id, { body: `Pendente ${i}` }, { ip: `203.0.113.${30 + i}` })).status).toBe(201);
    }
    const blocked = await send(post._id, { body: "Pendente 6" }, { ip: "203.0.113.99" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/aguardando aprovação/);
    expect(await Comment.countDocuments({ "author.sub": "google-1" })).toBe(5);

    // Outra pessoa não é afetada
    expect((await send(post._id, { body: "Outra pessoa" }, { sub: "google-2", ip: "203.0.113.98" })).status).toBe(201);
  });

  it("aprovar libera vaga entre os pendentes da pessoa", async () => {
    const admin = await asAdmin();
    const post = await published();
    let first;
    for (let i = 0; i < 5; i++) {
      const res = await send(post._id, { body: `Pendente ${i}` }, { ip: `203.0.113.${50 + i}` });
      first ||= res.body.id;
    }
    await admin.patch(`/api/comments/admin/${first}`).send({ status: "approved" });
    expect((await send(post._id, { body: "Cabe agora" }, { ip: "203.0.113.97" })).status).toBe(201);
  });
});

describe("um nível de resposta (R-COM-04)", () => {
  it("resposta a uma resposta fica presa ao comentário principal", async () => {
    const post = await published();
    const main = await make(post, { status: "approved" });
    const reply = await make(post, { status: "approved", parent: main._id });

    const res = await send(post._id, { body: "Respondendo a resposta", parentId: String(reply._id) });
    expect(res.status).toBe(201);
    expect(String(res.body.parent)).toBe(String(main._id));
  });

  it("não responde comentário pendente, recusado, removido, de outro post ou inexistente: 422", async () => {
    const post = await published();
    const other = await published({ title: "Outro post" });
    const targets = [
      await make(post, { status: "pending" }),
      await make(post, { status: "rejected" }),
      await make(post, { status: "approved", removedAt: new Date() }),
      await make(other, { status: "approved" }),
    ];
    for (const target of targets) {
      const res = await send(post._id, { body: "Resposta", parentId: String(target._id) }, { sub: `s-${target._id}` });
      expect(res.status).toBe(422);
    }
    const missing = await send(post._id, { body: "Resposta", parentId: "64b000000000000000000000" });
    expect(missing.status).toBe(422);
    expect(await Comment.countDocuments({ "author.sub": { $regex: /^google-1|^s-/ } })).toBe(0);
  });
});

describe("resposta do autor do blog (R-COM-05)", () => {
  it("aparece na hora e aprova o comentário respondido", async () => {
    const admin = await asAdmin();
    const post = await published();
    const pending = await make(post, { status: "pending" });

    const res = await admin.post(`/api/comments/admin/${pending._id}/reply`).send({ body: "Obrigado pelo comentário!" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "approved", isAuthor: true, body: "Obrigado pelo comentário!" });
    expect(String(res.body.parent)).toBe(String(pending._id));

    const target = await Comment.findById(pending._id).lean();
    expect(target.status).toBe("approved");
    expect(target.approvedAt).toBeTruthy();
    expect((await BlogPost.findById(post._id).lean()).commentsCount).toBe(2);
    expect((await list(post._id)).body.comments.map((c) => c.isAuthor)).toEqual([false, true]);
  });

  it("responder uma recusada também a aprova e limpa o motivo; responder uma resposta prende ao principal", async () => {
    const admin = await asAdmin();
    const post = await published();
    const rejected = await make(post, { status: "rejected", rejectionReason: "Fora do tema", rejectedAt: new Date() });
    await admin.post(`/api/comments/admin/${rejected._id}/reply`).send({ body: "Revi, ficou ok." });
    expect(await Comment.findById(rejected._id).lean()).toMatchObject({ status: "approved", rejectionReason: "", rejectedAt: null });

    const reply = await Comment.findOne({ parent: rejected._id });
    const nested = await admin.post(`/api/comments/admin/${reply._id}/reply`).send({ body: "Mais uma" });
    expect(String(nested.body.parent)).toBe(String(rejected._id));
  });

  it("só o painel responde como autor; texto vazio é recusado", async () => {
    const admin = await asAdmin();
    const post = await published();
    const c = await make(post);
    const url = `/api/comments/admin/${c._id}/reply`;
    expect((await api().post(url).set("Origin", PANEL_ORIGIN).set("Cookie", readerCookie()).send({ body: "Oi" })).status).toBe(401);
    expect((await admin.post(url).send({ body: " " })).status).toBe(422);
  });
});

describe("aviso por email ao autor (R-COM-06)", () => {
  it("cada comentário novo gera um email para o autor, com o texto escapado", async () => {
    vi.stubEnv("GMAIL_USER", "blog@teste.dev");
    vi.stubEnv("ADMIN_EMAIL", "autor@teste.dev");
    const post = await published({ title: "Meu post" });

    await send(post._id, { body: "Primeiro <b>oi</b>" }, { ip: "203.0.113.60" });
    await send(post._id, { body: "Segundo" }, { ip: "203.0.113.61" });

    expect(transporter.sendMail).toHaveBeenCalledTimes(2);
    const mail = transporter.sendMail.mock.calls[0][0];
    expect(mail.to).toBe("autor@teste.dev");
    expect(mail.subject).toBe('Novo comentário em "Meu post"');
    expect(mail.html).toContain("&lt;b&gt;oi&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>oi</b>");
  });

  it("falha no email não impede o comentário", async () => {
    vi.stubEnv("GMAIL_USER", "blog@teste.dev");
    vi.stubEnv("ADMIN_EMAIL", "autor@teste.dev");
    transporter.sendMail.mockRejectedValue(new Error("SMTP fora do ar"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const post = await published();
    expect((await send(post._id, { body: "Mesmo assim entra" })).status).toBe(201);
    expect(await Comment.countDocuments()).toBe(1);
  });
});

describe("apagar o próprio comentário (R-COM-07)", () => {
  const remove = (id, sub = "google-1") =>
    api().delete(`/api/comments/mine/${id}`).set("Origin", PANEL_ORIGIN).set("Cookie", readerCookie(sub));
  const mineOn = (post, overrides = {}) =>
    make(post, { author: { sub: "google-1", name: "Leitora Teste", email: "leitora@teste.dev" }, ...overrides });

  it("sem respostas de outras pessoas: apaga o comentário e as respostas da própria pessoa", async () => {
    const post = await published();
    const main = await mineOn(post, { status: "approved" });
    await mineOn(post, { status: "approved", parent: main._id });
    const keep = await make(post, { status: "approved" });

    const res = await remove(main._id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, removed: false });
    expect((await Comment.find().lean()).map((c) => String(c._id))).toEqual([String(keep._id)]);
    expect((await BlogPost.findById(post._id).lean()).commentsCount).toBe(1);
  });

  it("com resposta de outra pessoa: vira 'removido', sem texto nem dados, e a resposta dos outros fica", async () => {
    const post = await published();
    const main = await mineOn(post, { status: "approved" });
    const reply = await make(post, { status: "approved", parent: main._id });

    const res = await remove(main._id);
    expect(res.body).toEqual({ ok: true, removed: true });

    const saved = await Comment.findById(main._id).lean();
    expect(saved.removedAt).toBeTruthy();
    expect(saved).toMatchObject({ body: "", author: { sub: "", name: "", email: "", picture: "" } });
    expect(await Comment.exists({ _id: reply._id })).toBeTruthy();
    const shown = (await list(post._id)).body.comments.find((c) => String(c.id) === String(main._id));
    expect(shown).toMatchObject({ removed: true, body: "", name: "", mine: false });
  });

  it("não apaga comentário de outra pessoa nem sem login", async () => {
    const post = await published();
    const theirs = await make(post, { status: "approved" });
    expect((await remove(theirs._id)).status).toBe(404);
    expect(await Comment.exists({ _id: theirs._id })).toBeTruthy();
    const anonymous = await api().delete(`/api/comments/mine/${theirs._id}`).set("Origin", PANEL_ORIGIN);
    expect(anonymous.status).toBe(401);
    expect((await remove("lixo")).status).toBe(404);
  });

  it("o painel não consegue moderar um comentário que o leitor removeu: 409", async () => {
    const admin = await asAdmin();
    const post = await published();
    const main = await mineOn(post, { status: "approved" });
    await make(post, { status: "approved", parent: main._id });
    await remove(main._id);
    expect((await admin.patch(`/api/comments/admin/${main._id}`).send({ status: "rejected" })).status).toBe(409);
  });
});

describe("dados do leitor nunca aparecem (R-COM-08)", () => {
  it("lista pública: sem email nem id Google, nem do próprio leitor", async () => {
    const post = await published();
    await make(post, { status: "approved", author: { sub: "google-77", name: "Fulana", email: "fulana@teste.dev", picture: "https://x/f.png" } });
    await send(post._id, { body: "Pendente minha" });

    for (const sub of [undefined, "google-1", "google-77"]) {
      const res = await list(post._id, sub);
      const json = JSON.stringify(res.body);
      expect(json).not.toContain("fulana@teste.dev");
      expect(json).not.toContain("leitora@teste.dev");
      expect(json).not.toContain("google-77");
      expect(json).not.toContain("google-1\"");
      expect(json).not.toContain('"author"');
    }
    const first = (await list(post._id)).body.comments[0];
    expect(first).toMatchObject({ name: "Fulana", picture: "https://x/f.png" });
  });

  it("resposta de criação devolve só os campos públicos", async () => {
    const post = await published();
    const res = await send(post._id, { body: "Oi" });
    expect(JSON.stringify(res.body)).not.toContain("leitora@teste.dev");
    expect(res.body.author).toBeUndefined();
  });

  it("o painel (admin) vê o email para moderar; sem login, não", async () => {
    const admin = await asAdmin();
    const post = await published();
    await make(post, { status: "pending" });
    const res = await admin.get("/api/comments/admin?status=pending");
    expect(res.body.comments[0].author.email).toBe("outro@teste.dev");
    expect(res.body.counts).toMatchObject({ pending: 1, approved: 0, rejected: 0 });
    expect((await api().get("/api/comments/admin")).status).toBe(401);
  });
});
