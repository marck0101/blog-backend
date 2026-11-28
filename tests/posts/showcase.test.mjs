import { afterEach, describe, expect, it, vi } from "vitest";
import { PANEL_ORIGIN, api, asAdmin, createPost, daysFromToday, models } from "../helpers.mjs";

const { BlogPost, PostDailyStat } = models;

// TEST-06: vitrine e engajamento do leitor (SISTEMA.md, seção 8).
// Já cobertos em outros arquivos: R-ENG-03 evento "view" (posts/views.test.mjs: conta,
// robôs, rascunho, origem) e "ir para a lixeira desafixa" do R-VIT-01 (posts/trash.test.mjs).
// R-ENG-02 (favoritos ficam no navegador) é só do front: não há regra de backend para testar.

const published = (overrides = {}) =>
  createPost({ status: "published", published: true, publishedAt: new Date(), ...overrides });

// Leituras de um post em um dia (direto no banco)
const viewsOn = (post, day, views) => PostDailyStat.create({ post: post._id, day, views });

const get = async (url) => (await api().get(url)).body;
const titles = (list) => list.map((p) => p.title);

afterEach(() => vi.useRealTimers());

describe("fixados (R-VIT-01)", () => {
  it("até 3, na ordem do painel; o 4º é recusado", async () => {
    const admin = await asAdmin();
    const [a, b, c, d] = [await published({ title: "Post A" }), await published({ title: "Post B" }), await published({ title: "Post C" }), await published({ title: "Post D" })];

    const tooMany = await admin.put("/api/posts/showcase/pinned").send({ ids: [a, b, c, d].map((p) => String(p._id)) });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error).toMatch(/3/);

    const ok = await admin.put("/api/posts/showcase/pinned").send({ ids: [c, a, b].map((p) => String(p._id)) });
    expect(ok.status).toBe(200);
    expect(titles(await get("/api/posts/pinned"))).toEqual(["Post C", "Post A", "Post B"]);
  });

  it("trocar a lista desafixa quem saiu; lista vazia desafixa todos", async () => {
    const admin = await asAdmin();
    const a = await published({ title: "Post A" });
    const b = await published({ title: "Post B" });
    await admin.put("/api/posts/showcase/pinned").send({ ids: [String(a._id), String(b._id)] });

    await admin.put("/api/posts/showcase/pinned").send({ ids: [String(b._id)] });
    expect((await BlogPost.findById(a._id).lean()).pinnedOrder).toBeNull();
    expect((await BlogPost.findById(b._id).lean()).pinnedOrder).toBe(1);

    await admin.put("/api/posts/showcase/pinned").send({ ids: [] });
    expect(await BlogPost.countDocuments({ pinnedOrder: { $ne: null } })).toBe(0);
  });

  it("post na lixeira ou inexistente não pode ser fixado: 422", async () => {
    const admin = await asAdmin();
    const trashed = await published({ deletedAt: new Date() });
    expect((await admin.put("/api/posts/showcase/pinned").send({ ids: [String(trashed._id)] })).status).toBe(422);
    expect((await admin.put("/api/posts/showcase/pinned").send({ ids: ["64b000000000000000000000"] })).status).toBe(422);
  });

  it("fixado em rascunho não aparece para o leitor", async () => {
    const admin = await asAdmin();
    const draft = await createPost({ title: "Rascunho" });
    await admin.put("/api/posts/showcase/pinned").send({ ids: [String(draft._id)] });
    expect(await get("/api/posts/pinned")).toEqual([]);
  });

  it("fixados não repetem na lista da home (excludePinned=1), mas continuam na lista geral", async () => {
    const admin = await asAdmin();
    const a = await published({ title: "Fixado" });
    await published({ title: "Normal" });
    await admin.put("/api/posts/showcase/pinned").send({ ids: [String(a._id)] });

    expect(titles((await get("/api/posts/published?excludePinned=1")).posts)).toEqual(["Normal"]);
    expect(titles((await get("/api/posts/published")).posts).sort()).toEqual(["Fixado", "Normal"]);
  });

  it("só o admin muda os fixados", async () => {
    const a = await published();
    const res = await api().put("/api/posts/showcase/pinned").set("Origin", PANEL_ORIGIN).send({ ids: [String(a._id)] });
    expect(res.status).toBe(401);
  });
});

describe("destaques da semana (R-VIT-02)", () => {
  it("forçados primeiro (mais recentes antes), depois os mais lidos dos últimos 7 dias", async () => {
    const admin = await asAdmin();
    const today = daysFromToday(0);
    const forcedOld = await published({ title: "Forçado antigo", publishedAt: new Date("2026-01-01T12:00:00Z") });
    const forcedNew = await published({ title: "Forçado novo", publishedAt: new Date("2026-02-01T12:00:00Z") });
    const top = await published({ title: "Mais lido" });
    const second = await published({ title: "Segundo" });
    await published({ title: "Sem leitura" });
    await viewsOn(top, today, 50);
    await viewsOn(second, today, 10);
    await admin.patch(`/api/posts/${forcedOld._id}/highlight`).send({ highlight: "force" });
    await admin.patch(`/api/posts/${forcedNew._id}/highlight`).send({ highlight: "force" });

    expect(titles(await get("/api/posts/highlights"))).toEqual(["Forçado novo", "Forçado antigo", "Mais lido", "Segundo"]);
  });

  it("no máximo 4 destaques", async () => {
    const today = daysFromToday(0);
    for (let i = 1; i <= 6; i++) await viewsOn(await published({ title: `Post ${i}` }), today, i);
    const list = await get("/api/posts/highlights");
    expect(titles(list)).toEqual(["Post 6", "Post 5", "Post 4", "Post 3"]);
  });

  it("fixados e posts marcados 'esconder' nunca entram, nem despublicados ou na lixeira", async () => {
    const admin = await asAdmin();
    const today = daysFromToday(0);
    const pinned = await published({ title: "Fixado", pinnedOrder: 1 });
    const hidden = await published({ title: "Escondido" });
    const draft = await createPost({ title: "Rascunho" });
    const trashed = await published({ title: "Lixeira", deletedAt: new Date() });
    const normal = await published({ title: "Normal" });
    for (const p of [pinned, hidden, draft, trashed]) await viewsOn(p, today, 100);
    await viewsOn(normal, today, 1);
    await admin.patch(`/api/posts/${hidden._id}/highlight`).send({ highlight: "hide" });

    expect(titles(await get("/api/posts/highlights"))).toEqual(["Normal"]);
  });

  it("mesmo 'forçar' não traz fixado nem despublicado", async () => {
    const admin = await asAdmin();
    const pinned = await published({ title: "Fixado", pinnedOrder: 1 });
    const draft = await createPost({ title: "Rascunho" });
    await admin.patch(`/api/posts/${pinned._id}/highlight`).send({ highlight: "force" });
    await admin.patch(`/api/posts/${draft._id}/highlight`).send({ highlight: "force" });
    expect(await get("/api/posts/highlights")).toEqual([]);
  });

  it("a resposta pública não traz o número de leituras e o painel mostra o motivo", async () => {
    const admin = await asAdmin();
    const post = await published({ title: "Lido" });
    await viewsOn(post, daysFromToday(0), 7);

    const [card] = await get("/api/posts/highlights");
    expect(card).not.toHaveProperty("views");
    expect(card).not.toHaveProperty("views7d");
    expect(card).not.toHaveProperty("content");

    const panel = (await admin.get("/api/posts/showcase")).body;
    expect(panel.maxPinned).toBe(3);
    expect(panel.highlightDays).toBe(7);
    expect(panel.highlights[0]).toMatchObject({ title: "Lido", views7d: 7, reason: "auto" });
  });

  it("regra inválida: 422; post inexistente: 404", async () => {
    const admin = await asAdmin();
    const post = await published();
    expect((await admin.patch(`/api/posts/${post._id}/highlight`).send({ highlight: "sempre" })).status).toBe(422);
    expect((await admin.patch("/api/posts/64b000000000000000000000/highlight").send({ highlight: "force" })).status).toBe(404);
  });
});

describe("últimos 7 dias (R-VIT-03)", () => {
  it("inclui hoje e os 6 dias anteriores; o 7º dia para trás já fica de fora", async () => {
    const inside = await published({ title: "Dentro (6 dias atrás)" });
    const outside = await published({ title: "Fora (7 dias atrás)" });
    const today = await published({ title: "Hoje" });
    await viewsOn(inside, daysFromToday(-6), 5);
    await viewsOn(outside, daysFromToday(-7), 99);
    await viewsOn(today, daysFromToday(0), 1);

    expect(titles(await get("/api/posts/highlights")).sort()).toEqual(["Dentro (6 dias atrás)", "Hoje"]);
  });

  it("usa o fuso de Brasília: 02h30 UTC ainda é o dia anterior em Brasília", async () => {
    // 2026-06-10 02:30 UTC = 2026-06-09 23:30 em Brasília
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-06-10T02:30:00Z") });
    const post = await published({ title: "Lido de madrugada UTC" });

    const res = await api().post(`/api/posts/public/${post._id}/engage`).set("Origin", PANEL_ORIGIN).set("User-Agent", "Mozilla/5.0 Chrome/130.0 Safari/537.36").send({ type: "view" });
    expect(res.status).toBe(204);
    expect((await PostDailyStat.findOne({ post: post._id }).lean()).day).toBe("2026-06-09");

    // 2026-06-09 + 6 dias = limite inferior: 2026-06-03 dentro, 2026-06-02 fora
    const edge = await published({ title: "Limite" });
    const old = await published({ title: "Velho" });
    await viewsOn(edge, "2026-06-03", 3);
    await viewsOn(old, "2026-06-02", 3);
    expect(titles(await get("/api/posts/highlights")).sort()).toEqual(["Lido de madrugada UTC", "Limite"]);
  });
});

describe("continue lendo (R-VIT-04)", () => {
  const related = (post) => get(`/api/posts/public/${post._id}/related`);

  it("3 da mesma categoria, mais lidos primeiro, nunca o próprio post", async () => {
    const current = await published({ title: "Atual", category: "design", views: 1000 });
    await published({ title: "D-10", category: "design", views: 10 });
    await published({ title: "D-50", category: "design", views: 50 });
    await published({ title: "D-30", category: "design", views: 30 });
    await published({ title: "D-5", category: "design", views: 5 });
    await published({ title: "T-999", category: "tecnologia", views: 999 });

    expect(titles(await related(current))).toEqual(["D-50", "D-30", "D-10"]);
  });

  it("se faltar, completa com os mais lidos das outras categorias", async () => {
    const current = await published({ title: "Atual", category: "design" });
    await published({ title: "D-1", category: "design", views: 1 });
    await published({ title: "T-5", category: "tecnologia", views: 5 });
    await published({ title: "C-9", category: "carreira", views: 9 });
    await published({ title: "G-2", category: "growth", views: 2 });

    expect(titles(await related(current))).toEqual(["D-1", "C-9", "T-5"]);
  });

  it("só publicados e fora da lixeira; sem outros posts a lista é vazia", async () => {
    const current = await published({ title: "Atual", category: "design" });
    await createPost({ title: "Rascunho", category: "design", views: 100 });
    await published({ title: "Lixeira", category: "design", views: 100, deletedAt: new Date() });
    expect(await related(current)).toEqual([]);
  });

  it("post em rascunho ou inexistente: 404", async () => {
    const draft = await createPost();
    expect((await api().get(`/api/posts/public/${draft._id}/related`)).status).toBe(404);
  });
});

describe("eventos anônimos do leitor (R-ENG-01)", () => {
  const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
  const engage = (postId, body, ip) => {
    const req = api().post(`/api/posts/public/${postId}/engage`).set("Origin", PANEL_ORIGIN).set("User-Agent", BROWSER_UA);
    if (ip) req.set("X-Real-IP", ip);
    return req.send(body);
  };
  const stat = (post) => PostDailyStat.findOne({ post: post._id }).lean();

  it("favoritar e desfavoritar só somam contadores do post (total e do dia)", async () => {
    const post = await published();
    expect((await engage(post._id, { type: "favorite" })).status).toBe(204);
    expect((await engage(post._id, { type: "favorite" })).status).toBe(204);
    expect((await engage(post._id, { type: "unfavorite" })).status).toBe(204);

    expect((await BlogPost.findById(post._id).lean()).favorites).toBe(1);
    expect(await stat(post)).toMatchObject({ favorites: 2, unfavorites: 1 });
  });

  it("desfavoritar nunca deixa o total abaixo de zero", async () => {
    const post = await published();
    await engage(post._id, { type: "unfavorite" });
    expect((await BlogPost.findById(post._id).lean()).favorites).toBe(0);
  });

  it("compartilhar soma por canal; 'visita por link compartilhado' soma só no dia, por canal", async () => {
    const post = await published();
    await engage(post._id, { type: "share", channel: "whatsapp" });
    await engage(post._id, { type: "share", channel: "WhatsApp" });
    await engage(post._id, { type: "share", channel: "linkedin" });
    await engage(post._id, { type: "share_visit", channel: "x" });

    expect((await BlogPost.findById(post._id).lean()).shares).toBe(3);
    const s = await stat(post);
    expect(s.shares).toEqual({ whatsapp: 2, linkedin: 1 });
    expect(s.shareVisits).toEqual({ x: 1 });
  });

  it("canal desconhecido ou ausente, e tipo desconhecido: 422 e nada é gravado", async () => {
    const post = await published();
    expect((await engage(post._id, { type: "share", channel: "orkut" })).status).toBe(422);
    expect((await engage(post._id, { type: "share" })).status).toBe(422);
    expect((await engage(post._id, { type: "share_visit", channel: "" })).status).toBe(422);
    expect((await engage(post._id, { type: "curtir" })).status).toBe(422);
    expect((await engage(post._id, {})).status).toBe(422);
    expect(await PostDailyStat.countDocuments()).toBe(0);
    expect((await BlogPost.findById(post._id).lean()).shares).toBe(0);
  });

  it("não identifica quem fez: sem login, sem cookie, e nada pessoal fica no banco", async () => {
    const post = await published();
    await engage(post._id, { type: "favorite" }, "198.51.100.5");
    const doc = JSON.stringify(await stat(post));
    expect(doc).not.toContain("198.51.100.5");
    expect(Object.keys(await stat(post)).sort()).toEqual(
      ["_id", "day", "favorites", "post", "shareVisits", "shares", "unfavorites", "views"].sort(),
    );
  });

  it("limite: 60 eventos por IP a cada 10 min; o 61º recebe 429 com Retry-After", async () => {
    const post = await published();
    for (let i = 0; i < 60; i++) {
      const res = await engage(post._id, { type: "favorite" }, "198.51.100.10");
      if (res.status !== 204) throw new Error(`evento ${i + 1} devolveu ${res.status}`);
    }
    const blocked = await engage(post._id, { type: "favorite" }, "198.51.100.10");
    expect(blocked.status).toBe(429);
    const retry = Number(blocked.headers["retry-after"]);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(10 * 60);
    expect((await BlogPost.findById(post._id).lean()).favorites).toBe(60);

    // Outro IP segue livre
    expect((await engage(post._id, { type: "favorite" }, "198.51.100.11")).status).toBe(204);
  });

  it("o limite vale para todos os tipos juntos, e leitura (view) também passa por ele", async () => {
    const post = await published();
    for (let i = 0; i < 30; i++) await engage(post._id, { type: "share", channel: "copy" }, "198.51.100.12");
    for (let i = 0; i < 30; i++) await engage(post._id, { type: "view" }, "198.51.100.12");
    expect((await engage(post._id, { type: "share", channel: "copy" }, "198.51.100.12")).status).toBe(429);
  });

  it("evento em post inexistente, rascunho ou na lixeira: 404 e não gasta o limite", async () => {
    const draft = await createPost();
    const trashed = await published({ deletedAt: new Date() });
    for (const id of [draft._id, trashed._id, "64b000000000000000000000"]) {
      expect((await engage(id, { type: "favorite" }, "198.51.100.13")).status).toBe(404);
    }
    const ok = await published();
    for (let i = 0; i < 60; i++) await engage(ok._id, { type: "favorite" }, "198.51.100.13");
    expect((await engage(ok._id, { type: "favorite" }, "198.51.100.13")).status).toBe(429);
  });
});

describe("abrir o post pela API não conta leitura (R-ENG-03)", () => {
  it("GET /slug é só leitura: não soma views nem grava estatística do dia, nem muda o updatedAt", async () => {
    const post = await published({ title: "Só leitura" });
    const before = await BlogPost.findById(post._id).lean();

    for (const url of [`/api/posts/slug/${before.slug}`, `/api/posts/public/${post._id}`]) {
      const res = await api().get(url).set("User-Agent", "Mozilla/5.0 Chrome/130.0 Safari/537.36");
      expect(res.status).toBe(200);
    }

    const after = await BlogPost.findById(post._id).lean();
    expect(after.views).toBe(0);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await PostDailyStat.countDocuments()).toBe(0);
  });
});
