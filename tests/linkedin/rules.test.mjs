import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, asAdmin, createPost, models, transporter } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const linkedin = require("../../app/services/linkedin.service");
const LinkedInAccount = require("../../app/models/linkedinAccount.model");

const { BlogPost } = models;

// TEST-04: regras do LinkedIn (SISTEMA.md, seção 7, R-LI-01 a 07).
// `fetch` é sempre simulado: nenhum teste fala com o LinkedIn de verdade.

const POST_URN = "urn:li:share:111";
const COMMENT_URN = "urn:li:comment:(urn:li:activity:111,222)";
const NO_ID = "64b000000000000000000000";

/** Conta conectada (vale 60 dias por padrão) */
const connect = (overrides = {}) =>
  LinkedInAccount.create({
    personUrn: "urn:li:person:abc",
    name: "Autor",
    accessToken: "token-de-teste",
    expiresAt: new Date(Date.now() + 60 * 86400000),
    ...overrides,
  });

/** Post publicado com o LinkedIn ligado */
const linkedinPost = (linkedinFields = {}, overrides = {}) =>
  createPost({
    slug: "meu-artigo",
    published: true,
    status: "published",
    linkedin: { enabled: true, text: "Texto do post", ...linkedinFields },
    ...overrides,
  });

/**
 * fetch simulado: responde por rota e guarda as chamadas.
 * `fail` troca a resposta de uma rota (ex.: { post: 500 }).
 */
function mockLinkedIn({ fail = {} } = {}) {
  const calls = [];
  const reply = (key, init, body = {}) =>
    fail[key]
      ? new Response(JSON.stringify({ message: "erro simulado" }), { status: fail[key] })
      : new Response(JSON.stringify(body), init);
  const fn = vi.fn(async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", body: init.body });
    if (u.includes("/rest/images?action=initializeUpload"))
      return reply("init", { status: 200 }, { value: { uploadUrl: "https://upload.test/x", image: "urn:li:image:1" } });
    if (u.startsWith("https://upload.test/")) return reply("put", { status: 201 });
    if (u.endsWith("/rest/posts")) return reply("post", { status: 201, headers: { "x-restli-id": POST_URN } });
    if (u.includes("/socialActions/")) {
      const key = u.includes("/v2/") ? "comment" : "commentRest";
      return reply(key, { status: 201, headers: { "x-restli-id": COMMENT_URN } });
    }
    // download da imagem
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return {
    calls,
    posts: () => calls.filter((c) => c.url.endsWith("/rest/posts")),
    comments: () => calls.filter((c) => c.url.includes("/socialActions/")),
  };
}

afterEach(() => vi.unstubAllEnvs());

const reload = (post) => BlogPost.findById(post._id).lean();

describe("R-LI-01 link no comentário, não no post", () => {
  it("o texto do post não leva o link; o comentário leva, com UTM", async () => {
    await connect();
    const net = mockLinkedIn();
    const post = await linkedinPost({ text: "Texto sem link", comment: "Leia: {link}" });
    await linkedin.shareArticle(post._id);

    const postBody = JSON.parse(net.posts()[0].body);
    expect(postBody.commentary).not.toMatch(/https?:/);
    expect(postBody.commentary).not.toContain("meu-artigo");

    const commentBody = JSON.parse(net.comments()[0].body);
    const url = new URL(commentBody.message.text.replace("Leia: ", ""));
    expect(url.pathname).toBe("/blog/meu-artigo");
    expect(url.searchParams.get("utm_source")).toBe("linkedin");
    expect(url.searchParams.get("utm_medium")).toBe("social");
    expect(url.searchParams.get("utm_campaign")).toBe("post-meu-artigo");
    expect(url.searchParams.get("utm_content")).toBe("comentario");
  });

  it("comentário vazio usa o texto padrão; sem {link} nem URL, acrescenta o link", async () => {
    const post = await linkedinPost({ comment: "" });
    expect(linkedin.commentText(post)).toMatch(/^Artigo completo no blog: https:\/\/.+\/blog\/meu-artigo\?utm_source=linkedin/);

    const semLink = await linkedinPost({ comment: "Leia agora" }, { slug: "outro" });
    expect(linkedin.commentText(semLink)).toMatch(/^Leia agora\nhttps:\/\/.+\/blog\/outro\?/);
  });

  it("link escrito à mão no comentário é respeitado (sem duplicar)", async () => {
    const post = await linkedinPost({ comment: "Veja https://exemplo.com/x" });
    expect(linkedin.commentText(post)).toBe("Veja https://exemplo.com/x");
  });
});

describe("R-LI-02 idempotente", () => {
  it("fluxo completo: imagem, post e comentário, status posted", async () => {
    await connect();
    const net = mockLinkedIn();
    const post = await linkedinPost({}, { coverImage: "https://img.test/capa.jpg" });
    const result = await linkedin.shareArticle(post._id);

    expect(result).toMatchObject({ postUrn: POST_URN, commentUrn: COMMENT_URN });
    expect(net.posts()).toHaveLength(1);
    expect(net.comments()).toHaveLength(1);
    const saved = await reload(post);
    expect(saved.linkedin).toMatchObject({ status: "posted", postUrn: POST_URN, commentUrn: COMMENT_URN, error: "" });
  });

  it("dois processos ao mesmo tempo: só um pega o post, o outro não faz nada", async () => {
    await connect();
    const net = mockLinkedIn();
    const post = await linkedinPost();
    const [a, b] = await Promise.all([linkedin.shareArticle(post._id), linkedin.shareArticle(post._id)]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(net.posts()).toHaveLength(1);
    expect(net.comments()).toHaveLength(1);
  });

  it("post já publicado ou em andamento não é pego de novo", async () => {
    await connect();
    const net = mockLinkedIn();
    const posted = await linkedinPost({ status: "posted", postUrn: POST_URN });
    const posting = await linkedinPost({ status: "posting", attemptedAt: new Date() }, { slug: "b" });

    expect(await linkedin.shareArticle(posted._id)).toBeNull();
    expect(await linkedin.shareArticle(posting._id)).toBeNull();
    expect(net.calls).toHaveLength(0);
  });

  it("só pega post publicado, com LinkedIn ligado e fora da lixeira", async () => {
    await connect();
    const net = mockLinkedIn();
    const rascunho = await linkedinPost({}, { published: false, status: "draft" });
    const desligado = await linkedinPost({ enabled: false }, { slug: "b" });
    const lixeira = await linkedinPost({}, { slug: "c", deletedAt: new Date() });

    for (const p of [rascunho, desligado, lixeira]) expect(await linkedin.shareArticle(p._id)).toBeNull();
    expect(net.calls).toHaveLength(0);
  });

  it("falhou só o comentário: a nova tentativa faz só o comentário (não duplica o post)", async () => {
    await connect();
    const post = await linkedinPost();

    const first = mockLinkedIn({ fail: { comment: 500, commentRest: 500 } });
    await expect(linkedin.shareArticle(post._id)).rejects.toThrow(/Comentário recusado/);
    expect(first.posts()).toHaveLength(1);
    const failed = await reload(post);
    expect(failed.linkedin).toMatchObject({ status: "failed", postUrn: POST_URN });
    expect(failed.linkedin.postedAt).toBeInstanceOf(Date);

    const retry = mockLinkedIn();
    await linkedin.shareArticle(post._id);
    expect(retry.posts()).toHaveLength(0);
    expect(retry.calls.some((c) => c.url.includes("/rest/images"))).toBe(false);
    expect(retry.comments()).toHaveLength(1);
    expect((await reload(post)).linkedin).toMatchObject({ status: "posted", commentUrn: COMMENT_URN, error: "" });
  });

  it("falhou o post (sem URN): a nova tentativa cria o post do zero", async () => {
    await connect();
    const post = await linkedinPost();
    mockLinkedIn({ fail: { post: 500 } });
    await expect(linkedin.shareArticle(post._id)).rejects.toThrow(/LinkedIn 500/);
    expect((await reload(post)).linkedin).toMatchObject({ status: "failed", postUrn: "" });

    const retry = mockLinkedIn();
    await linkedin.shareArticle(post._id);
    expect(retry.posts()).toHaveLength(1);
  });

  it("sem imagem própria nem capa, o post sai sem imagem", async () => {
    await connect();
    const net = mockLinkedIn();
    const post = await linkedinPost();
    await linkedin.shareArticle(post._id);
    expect(net.calls.some((c) => c.url.includes("/rest/images"))).toBe(false);
    expect(JSON.parse(net.posts()[0].body).content).toBeUndefined();
  });

  it("imagem do LinkedIn vazia usa a capa do artigo", async () => {
    await connect();
    const net = mockLinkedIn();
    const post = await linkedinPost({ imageUrl: "" }, { coverImage: "https://img.test/capa.jpg" });
    await linkedin.shareArticle(post._id);
    expect(net.calls[0].url).toBe("https://img.test/capa.jpg");
    expect(JSON.parse(net.posts()[0].body).content.media.id).toBe("urn:li:image:1");
  });
});

describe("R-LI-03 'posting' parado exige confirmação", () => {
  const minutesAgo = (m) => new Date(Date.now() - m * 60000);

  it("posting há menos de 5 min: em andamento (409), nada é chamado", async () => {
    await connect();
    const net = mockLinkedIn();
    const post = await linkedinPost({ status: "posting", attemptedAt: minutesAgo(2) });
    await expect(linkedin.retryShare(post._id, { force: true })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/em andamento/),
    });
    expect(net.calls).toHaveLength(0);
    expect((await reload(post)).linkedin.status).toBe("posting");
  });

  it("parado há mais de 5 min e sem post criado: pede confirmação e não publica", async () => {
    await connect();
    const net = mockLinkedIn();
    const post = await linkedinPost({ status: "posting", attemptedAt: minutesAgo(10) });
    await expect(linkedin.retryShare(post._id)).rejects.toMatchObject({ status: 409, needsConfirm: true });
    expect(net.calls).toHaveLength(0);
    expect((await reload(post)).linkedin.status).toBe("posting");
  });

  it("com force (a pessoa conferiu no perfil): publica", async () => {
    await connect();
    const net = mockLinkedIn();
    const post = await linkedinPost({ status: "posting", attemptedAt: minutesAgo(10) });
    await linkedin.retryShare(post._id, { force: true });
    expect(net.posts()).toHaveLength(1);
    expect((await reload(post)).linkedin.status).toBe("posted");
  });

  it("parado, mas o post já existe: não precisa de confirmação e só comenta", async () => {
    await connect();
    const net = mockLinkedIn();
    const post = await linkedinPost({ status: "posting", attemptedAt: minutesAgo(10), postUrn: POST_URN });
    await linkedin.retryShare(post._id);
    expect(net.posts()).toHaveLength(0);
    expect(net.comments()).toHaveLength(1);
  });

  it("posting sem data da tentativa conta como parado", async () => {
    await connect();
    mockLinkedIn();
    const post = await linkedinPost({ status: "posting" });
    await expect(linkedin.retryShare(post._id)).rejects.toMatchObject({ needsConfirm: true });
  });

  it("já publicado: 409; artigo não publicado ou LinkedIn desligado: 422; inexistente: 404", async () => {
    await connect();
    mockLinkedIn();
    const posted = await linkedinPost({ status: "posted" });
    const draft = await linkedinPost({}, { slug: "b", published: false, status: "draft" });
    const off = await linkedinPost({ enabled: false }, { slug: "c" });
    await expect(linkedin.retryShare(posted._id)).rejects.toMatchObject({ status: 409 });
    await expect(linkedin.retryShare(draft._id)).rejects.toMatchObject({ status: 422 });
    await expect(linkedin.retryShare(off._id)).rejects.toMatchObject({ status: 422 });
    await expect(linkedin.retryShare(NO_ID)).rejects.toMatchObject({ status: 404 });
  });

  it("na rota: 409 com needsConfirm e, com force, publica", async () => {
    await connect();
    const net = mockLinkedIn();
    const admin = await asAdmin();
    const post = await linkedinPost({ status: "posting", attemptedAt: minutesAgo(10) });

    const blocked = await admin.post(`/api/linkedin/posts/${post._id}/share`).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.needsConfirm).toBe(true);
    expect(net.calls).toHaveLength(0);

    const ok = await admin.post(`/api/linkedin/posts/${post._id}/share`).send({ force: true });
    expect(ok.status).toBe(200);
    expect(ok.body.postUrn).toBe(POST_URN);
    expect(net.posts()).toHaveLength(1);
  });

  it("na rota: force só vale como booleano", async () => {
    const admin = await asAdmin();
    const post = await linkedinPost({ status: "posting", attemptedAt: minutesAgo(10) });
    const res = await admin.post(`/api/linkedin/posts/${post._id}/share`).send({ force: "true" });
    expect(res.status).toBe(422);
  });
});

describe("R-LI-04 falha no LinkedIn não desfaz a publicação nem o email", () => {
  it("erro fica gravado no post (status failed, mensagem) e o artigo segue publicado", async () => {
    await connect();
    mockLinkedIn({ fail: { post: 403 } });
    const post = await linkedinPost();
    await expect(linkedin.shareArticle(post._id)).rejects.toThrow(/LinkedIn 403/);

    const saved = await reload(post);
    expect(saved.published).toBe(true);
    expect(saved.linkedin.status).toBe("failed");
    expect(saved.linkedin.error).toMatch(/LinkedIn 403/);
  });

  it("mensagem de erro gravada é limitada a 300 caracteres", async () => {
    await connect();
    vi.stubGlobal("fetch", async () => new Response("x".repeat(1000), { status: 500 }));
    const post = await linkedinPost();
    await expect(linkedin.shareArticle(post._id)).rejects.toThrow();
    expect((await reload(post)).linkedin.error.length).toBeLessThanOrEqual(300);
  });

  it("texto do LinkedIn vazio, ou sem conta conectada: failed, sem chamar a rede", async () => {
    const net = mockLinkedIn();
    const semTexto = await linkedinPost({ text: "  " });
    await expect(linkedin.shareArticle(semTexto._id)).rejects.toThrow(/Texto do LinkedIn vazio/);

    const semConta = await linkedinPost({}, { slug: "b" });
    await expect(linkedin.shareArticle(semConta._id)).rejects.toThrow(/não conectado/);
    expect((await reload(semConta)).linkedin.status).toBe("failed");
    expect(net.calls).toHaveLength(0);
  });

  it("safeShareArticle engole o erro (não propaga) e ignora post com LinkedIn desligado", async () => {
    await connect();
    const net = mockLinkedIn({ fail: { post: 500 } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const post = await linkedinPost();
    await expect(linkedin.safeShareArticle(post)).resolves.toBeUndefined();
    expect((await reload(post)).linkedin.status).toBe("failed");

    const off = await linkedinPost({ enabled: false }, { slug: "b" });
    await linkedin.safeShareArticle(off);
    expect(net.posts()).toHaveLength(1);
  });

  it("publicar pela API com o LinkedIn fora do ar: artigo publicado e email enviado", async () => {
    // Email só sai com as credenciais configuradas; o transporter é simulado
    vi.stubEnv("GMAIL_USER", "blog@teste.dev");
    vi.stubEnv("GMAIL_APP_PASSWORD", "x");
    await connect();
    mockLinkedIn({ fail: { post: 500 } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = await asAdmin();
    await models.Subscriber.create({ email: "leitor@teste.dev", categories: ["tecnologia"] });

    const res = await admin.post("/api/posts").send({
      title: "Artigo com LinkedIn",
      category: "tecnologia",
      status: "published",
      content: "<p>Conteúdo com mais de dez caracteres.</p>",
      linkedin: { enabled: true, text: "Texto do post" },
    });
    expect(res.status).toBe(201);

    const saved = await BlogPost.findOne({ title: "Artigo com LinkedIn" }).lean();
    expect(saved.published).toBe(true);
    expect(saved.linkedin.status).toBe("failed");
    expect(saved.linkedin.error).toMatch(/LinkedIn 500/);
    expect(transporter.sendMail.mock.calls.map((c) => c[0].to)).toContain("leitor@teste.dev");
  });

  it("falha na rota de nova tentativa: 502 com a mensagem, erro gravado no post", async () => {
    await connect();
    mockLinkedIn({ fail: { post: 500 } });
    const admin = await asAdmin();
    const post = await linkedinPost({ status: "failed" });
    const res = await admin.post(`/api/linkedin/posts/${post._id}/share`).send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/LinkedIn 500/);
    expect((await reload(post)).linkedin.error).toMatch(/LinkedIn 500/);
  });

  it("nova tentativa de um failed zera o erro e publica", async () => {
    await connect();
    const net = mockLinkedIn();
    const post = await linkedinPost({ status: "failed", error: "erro antigo" });
    await linkedin.retryShare(post._id);
    expect(net.posts()).toHaveLength(1);
    expect((await reload(post)).linkedin).toMatchObject({ status: "posted", error: "" });
  });
});

describe("R-LI-05 conexão de 60 dias, sem renovar sozinha", () => {
  it("status mostra quantos dias faltam", async () => {
    await connect({ expiresAt: new Date(Date.now() + 10.5 * 86400000) });
    expect(await linkedin.getStatus()).toMatchObject({ connected: true, expired: false, daysLeft: 10 });
  });

  it("conectar grava a validade de expires_in (60 dias)", async () => {
    vi.stubGlobal("fetch", async (url) =>
      String(url).includes("accessToken")
        ? new Response(JSON.stringify({ access_token: "t", expires_in: 60 * 86400, scope: "openid" }), { status: 200 })
        : new Response(JSON.stringify({ sub: "xyz", name: "Autor" }), { status: 200 })
    );
    await linkedin.connectWithCode("codigo");
    expect(await linkedin.getStatus()).toMatchObject({ connected: true, daysLeft: 59 });
    expect((await LinkedInAccount.findOne().lean()).personUrn).toBe("urn:li:person:xyz");
  });

  it("conexão vencida: status expired e a publicação falha pedindo reconexão", async () => {
    await connect({ expiresAt: new Date(Date.now() - 86400000) });
    const net = mockLinkedIn();
    expect(await linkedin.getStatus()).toMatchObject({ connected: false, expired: true, daysLeft: 0 });

    const post = await linkedinPost();
    await expect(linkedin.shareArticle(post._id)).rejects.toThrow(/expirou; reconecte/);
    expect((await reload(post)).linkedin.status).toBe("failed");
    expect(net.calls).toHaveLength(0);
  });

  it("não há renovação automática: nenhuma chamada de OAuth ao publicar", async () => {
    await connect({ expiresAt: new Date(Date.now() + 86400000) });
    const net = mockLinkedIn();
    await linkedin.shareArticle((await linkedinPost())._id);
    expect(net.calls.some((c) => /oauth|accessToken|refresh/i.test(c.url))).toBe(false);
  });

  it("sem conta: connected false", async () => {
    expect(await linkedin.getStatus()).toMatchObject({ connected: false });
  });
});

describe("R-LI-06 uma conta por vez", () => {
  it("conectar de novo substitui a conta anterior", async () => {
    await connect({ personUrn: "urn:li:person:antiga" });
    vi.stubGlobal("fetch", async (url) =>
      String(url).includes("accessToken")
        ? new Response(JSON.stringify({ access_token: "novo", expires_in: 5184000 }), { status: 200 })
        : new Response(JSON.stringify({ sub: "nova", name: "Outra Pessoa" }), { status: 200 })
    );
    await linkedin.connectWithCode("codigo");

    const accounts = await LinkedInAccount.find().select("+accessToken").lean();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ personUrn: "urn:li:person:nova", accessToken: "novo" });
  });

  it("falha ao conectar (token recusado) mantém a conta atual", async () => {
    await connect({ personUrn: "urn:li:person:antiga" });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    await expect(linkedin.connectWithCode("ruim")).rejects.toThrow(/invalid_grant/);
    expect((await LinkedInAccount.find().lean()).map((a) => a.personUrn)).toEqual(["urn:li:person:antiga"]);
  });

  it("desconectar remove a conta e o token nunca aparece no status", async () => {
    await connect();
    expect(JSON.stringify(await linkedin.getStatus())).not.toContain("token-de-teste");
    await linkedin.disconnect();
    expect(await LinkedInAccount.countDocuments()).toBe(0);
  });

  it("o post sai em nome da conta conectada", async () => {
    await connect({ personUrn: "urn:li:person:dono" });
    const net = mockLinkedIn();
    await linkedin.shareArticle((await linkedinPost())._id);
    expect(JSON.parse(net.posts()[0].body).author).toBe("urn:li:person:dono");
  });
});

describe("R-LI-07 o painel só edita texto, imagem, comentário e liga/desliga", () => {
  it("campos de sistema enviados pelo painel são ignorados: nada é gravado", async () => {
    const admin = await asAdmin();
    const post = await createPost();
    for (const campo of [
      { status: "posted" },
      { postUrn: "urn:li:share:falso" },
      { commentUrn: "urn:li:comment:falso" },
      { error: "x" },
      { attemptedAt: new Date().toISOString() },
      { postedAt: new Date().toISOString() },
    ]) {
      const res = await admin.put(`/api/posts/${post._id}`).send({ linkedin: { enabled: true, ...campo } });
      expect(res.status, JSON.stringify(campo)).toBe(200);
    }
    const saved = await reload(post);
    expect(saved.linkedin).toMatchObject({ enabled: true, status: "idle", postUrn: "", commentUrn: "", error: "" });
  });

  it("os 4 campos editáveis são gravados, sem apagar o que o sistema guardou", async () => {
    const admin = await asAdmin();
    const post = await createPost({ linkedin: { status: "failed", postUrn: POST_URN, error: "falhou" } });
    const res = await admin.put(`/api/posts/${post._id}`).send({
      linkedin: { enabled: true, text: "Novo texto", imageUrl: "https://img.test/a.jpg", comment: "Veja {link}" },
    });
    expect(res.status).toBe(200);
    expect((await reload(post)).linkedin).toMatchObject({
      enabled: true,
      text: "Novo texto",
      imageUrl: "https://img.test/a.jpg",
      comment: "Veja {link}",
      status: "failed",
      postUrn: POST_URN,
      error: "falhou",
    });
  });

  it("editar um só campo não mexe nos outros", async () => {
    const admin = await asAdmin();
    const post = await createPost({ linkedin: { enabled: true, text: "Texto", comment: "Comentário" } });
    await admin.put(`/api/posts/${post._id}`).send({ linkedin: { text: "Só o texto mudou" } });
    expect((await reload(post)).linkedin).toMatchObject({ enabled: true, text: "Só o texto mudou", comment: "Comentário" });
  });

  it("criar o post já com campos de sistema do LinkedIn também os ignora", async () => {
    const admin = await asAdmin();
    const res = await admin
      .post("/api/posts")
      .send({ title: "Com LinkedIn", category: "tecnologia", linkedin: { enabled: true, status: "posted", postUrn: "urn:falso" } });
    expect(res.status).toBe(201);
    const saved = await BlogPost.findOne({ title: "Com LinkedIn" }).lean();
    expect(saved.linkedin).toMatchObject({ enabled: true, status: "idle", postUrn: "" });
  });

  it("rotas do LinkedIn exigem login do painel (exceto o callback, que valida o state assinado)", async () => {
    for (const [method, url] of [
      ["get", "/api/linkedin/status"],
      ["get", "/api/linkedin/connect"],
      ["delete", "/api/linkedin"],
      ["post", `/api/linkedin/posts/${NO_ID}/share`],
    ]) {
      const res = await api()[method](url).set("Origin", "http://localhost:5173");
      expect(res.status, `${method} ${url}`).toBe(401);
    }
    const cb = await api().get("/api/linkedin/callback?state=falso&code=x");
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toMatch(/linkedin=error/);
  });
});
