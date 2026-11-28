import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { api, asAdmin, createPost, models } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const { Season, BlogPost } = models;

// TEST-05: regras de season (SISTEMA.md, seção 4: R-SEASON-01 a 08)

const published = (overrides = {}) => ({ status: "published", published: true, publishedAt: new Date(), ...overrides });
const words = (n) => `<p>${"palavra ".repeat(n)}</p>`;
const slugsOf = (res) => res.body.map((s) => s.slug);

describe("cadastro (R-SEASON-01, R-SEASON-02)", () => {
  it("R-SEASON-01 cria com título e descrição; o slug sai do título quando não vem", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/seasons").send({ title: "Minha Série Nova", description: "Do zero ao fim" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "Minha Série Nova", slug: "minha-serie-nova", description: "Do zero ao fim", order: 0 });
  });

  it("R-SEASON-01 slug informado vira formato de endereço (minúsculas, sem acento)", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/seasons").send({ title: "Série", slug: "Séries Boas 2" });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("series-boas-2");
  });

  it("R-SEASON-01 título com menos de 3 ou mais de 100 caracteres: recusa", async () => {
    const admin = await asAdmin();
    expect((await admin.post("/api/seasons").send({ title: "ab", slug: "curto" })).status).toBeGreaterThanOrEqual(400);
    expect((await admin.post("/api/seasons").send({ title: "a".repeat(101), slug: "longo" })).status).toBeGreaterThanOrEqual(400);
    expect(await Season.countDocuments({ slug: { $in: ["curto", "longo"] } })).toBe(0);
  });

  it("R-SEASON-01 descrição acima de 600 caracteres: recusa", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/seasons").send({ title: "Série longa", description: "x".repeat(601) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await Season.countDocuments()).toBe(0);
  });

  it("R-SEASON-01 FAQ: só pares completos vão para o banco", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/seasons").send({
      title: "Série com FAQ",
      faq: [
        { question: "P1?", answer: "R1" },
        { question: "Sem resposta", answer: "" },
        { question: "", answer: "Sem pergunta" },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.faq).toEqual([{ question: "P1?", answer: "R1" }]);
  });

  it("R-SEASON-01 slug repetido: recusa", async () => {
    const admin = await asAdmin();
    await admin.post("/api/seasons").send({ title: "Primeira", slug: "mesma" });
    const res = await admin.post("/api/seasons").send({ title: "Segunda", slug: "mesma" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await Season.countDocuments({ slug: "mesma" })).toBe(1);
  });

  it("R-SEASON-01 só o admin cadastra", async () => {
    const res = await api().post("/api/seasons").send({ title: "Intrusa", slug: "intrusa" });
    expect(res.status).toBe(401);
    expect(await Season.countDocuments()).toBe(0);
  });

  it("R-SEASON-02 o slug 'admin' é reservado, ao criar e ao editar", async () => {
    const admin = await asAdmin();
    const created = await admin.post("/api/seasons").send({ title: "Admin", slug: "admin" });
    expect(created.status).toBe(422);
    // Sem slug, o título "Admin" também vira "admin"
    expect((await admin.post("/api/seasons").send({ title: "Admin" })).status).toBe(422);

    const season = await Season.create({ title: "Normal", slug: "normal" });
    const edited = await admin.patch(`/api/seasons/${season._id}`).send({ slug: "Admin" });
    expect(edited.status).toBe(422);
    expect((await Season.findById(season._id).lean()).slug).toBe("normal");
  });
});

describe("o que o leitor vê (R-SEASON-03, R-SEASON-04)", () => {
  it("R-SEASON-03 season sem episódio publicado: fora da lista e 404 na página", async () => {
    await Season.create({ title: "Vazia", slug: "vazia" });
    await Season.create({ title: "Só rascunho", slug: "so-rascunho" });
    await Season.create({ title: "Só agendado", slug: "so-agendado" });
    await Season.create({ title: "Só lixeira", slug: "so-lixeira" });
    await createPost({ title: "Rascunho", season: "so-rascunho" });
    await createPost({ title: "Agendado", season: "so-agendado", status: "planned", plannedAt: new Date(Date.now() + 86400000) });
    await createPost(published({ title: "Na lixeira", season: "so-lixeira", deletedAt: new Date() }));

    const list = await api().get("/api/seasons");
    expect(list.status).toBe(200);
    for (const slug of ["vazia", "so-rascunho", "so-agendado", "so-lixeira"]) {
      expect(slugsOf(list)).not.toContain(slug);
      expect((await api().get(`/api/seasons/${slug}`)).status).toBe(404);
    }
    // Nem o nome aparece na resposta
    expect(JSON.stringify(list.body)).not.toContain("Só rascunho");
  });

  it("R-SEASON-03 ?soft=1 devolve null em vez de 404; slug inexistente também é 404", async () => {
    await Season.create({ title: "Vazia", slug: "vazia" });
    const soft = await api().get("/api/seasons/vazia?soft=1");
    expect(soft.status).toBe(200);
    expect(soft.body).toBeNull();
    expect((await api().get("/api/seasons/nao-existe")).status).toBe(404);
  });

  it("R-SEASON-03 com 1 episódio publicado, a season aparece", async () => {
    await Season.create({ title: "Viva", slug: "viva", description: "Descrição" });
    await createPost(published({ title: "Ep 1", season: "viva", seasonOrder: 1 }));

    const list = await api().get("/api/seasons");
    expect(list.body.find((s) => s.slug === "viva")).toMatchObject({ title: "Viva", episodes: 1 });
    const one = await api().get("/api/seasons/viva");
    expect(one.status).toBe(200);
    expect(one.body.season).toMatchObject({ slug: "viva", title: "Viva", description: "Descrição" });
  });

  it("R-SEASON-04 ordena por seasonOrder e, empatando, por data de publicação; só publicados", async () => {
    await Season.create({ title: "Ordem", slug: "ordem" });
    const d = (n) => new Date(Date.UTC(2026, 0, n));
    await createPost(published({ title: "C ordem 2 tarde", season: "ordem", seasonOrder: 2, publishedAt: d(20) }));
    await createPost(published({ title: "B ordem 2 cedo", season: "ordem", seasonOrder: 2, publishedAt: d(10) }));
    await createPost(published({ title: "A ordem 1", season: "ordem", seasonOrder: 1, publishedAt: d(30) }));
    await createPost({ title: "Rascunho", season: "ordem", seasonOrder: 0 });
    await createPost({ title: "Agendado", season: "ordem", seasonOrder: 0, status: "planned", plannedAt: new Date(Date.now() + 86400000) });
    await createPost(published({ title: "Lixeira", season: "ordem", seasonOrder: 0, deletedAt: new Date() }));

    const one = await api().get("/api/seasons/ordem");
    expect(one.body.posts.map((p) => p.title)).toEqual(["A ordem 1", "B ordem 2 cedo", "C ordem 2 tarde"]);
    const inList = (await api().get("/api/seasons")).body.find((s) => s.slug === "ordem");
    expect(inList.episodes).toBe(3);
    expect(inList.episodeSlugs).toHaveLength(3);
  });

  it("a lista /seasons respeita a ordem da season e a página não vaza o conteúdo do episódio", async () => {
    await Season.create({ title: "Segunda", slug: "segunda", order: 2 });
    await Season.create({ title: "Primeira", slug: "primeira", order: 1 });
    await createPost(published({ title: "Ep um", season: "segunda" }));
    await createPost(published({ title: "Ep dois", season: "primeira" }));
    expect(slugsOf(await api().get("/api/seasons"))).toEqual(["primeira", "segunda"]);
    const one = await api().get("/api/seasons/primeira");
    expect(one.body.posts[0]).not.toHaveProperty("content");
    expect(one.body.posts[0]).toHaveProperty("readingMinutes");
  });
});

describe("manutenção (R-SEASON-05, R-SEASON-06)", () => {
  it("R-SEASON-05 trocar o slug atualiza todos os posts da season, inclusive rascunho e lixeira", async () => {
    const admin = await asAdmin();
    const season = await Season.create({ title: "Antiga", slug: "antiga" });
    const a = await createPost(published({ title: "Post A", season: "antiga" }));
    const b = await createPost({ title: "Post B", season: "antiga" });
    const c = await createPost({ title: "Post C", season: "antiga", deletedAt: new Date() });
    const outro = await createPost({ title: "Post D", season: "outra" });

    const res = await admin.patch(`/api/seasons/${season._id}`).send({ slug: "Nova Slug" });
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("nova-slug");
    for (const p of [a, b, c]) expect((await BlogPost.findById(p._id).lean()).season).toBe("nova-slug");
    expect((await BlogPost.findById(outro._id).lean()).season).toBe("outra");
  });

  it("R-SEASON-05 editar sem trocar o slug não mexe nos posts; id inexistente: 404", async () => {
    const admin = await asAdmin();
    const season = await Season.create({ title: "Estável", slug: "estavel" });
    const p = await createPost({ season: "estavel" });
    const res = await admin.patch(`/api/seasons/${season._id}`).send({ title: "Estável editada", description: "nova" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "Estável editada", slug: "estavel" });
    expect((await BlogPost.findById(p._id).lean()).season).toBe("estavel");
    expect((await admin.patch("/api/seasons/64b000000000000000000000").send({ title: "Qualquer" })).status).toBe(404);
  });

  it("R-SEASON-06 excluir com post em uso (qualquer status) é recusado com 409", async () => {
    const admin = await asAdmin();
    for (const [slug, overrides] of [
      ["com-publicado", published()],
      ["com-rascunho", {}],
      ["com-lixeira", { deletedAt: new Date() }],
    ]) {
      const season = await Season.create({ title: slug, slug });
      await createPost({ title: `Post ${slug}`, season: slug, ...overrides });
      const res = await admin.delete(`/api/seasons/${season._id}`);
      expect(res.status, slug).toBe(409);
      expect(await Season.exists({ _id: season._id }), slug).toBeTruthy();
    }
  });

  it("R-SEASON-06 sem nenhum post usando, exclui; id inexistente: 404; sem login: 401", async () => {
    const admin = await asAdmin();
    const season = await Season.create({ title: "Livre", slug: "livre" });
    expect((await api().delete(`/api/seasons/${season._id}`)).status).toBe(401);
    expect((await admin.delete(`/api/seasons/${season._id}`)).status).toBe(200);
    expect(await Season.exists({ _id: season._id })).toBeNull();
    expect((await admin.delete(`/api/seasons/${season._id}`)).status).toBe(404);
  });

  it("R-SEASON-06 depois de tirar o post da lixeira da season, dá para excluir", async () => {
    const admin = await asAdmin();
    const season = await Season.create({ title: "Esvaziando", slug: "esvaziando" });
    const p = await createPost({ season: "esvaziando", deletedAt: new Date() });
    expect((await admin.delete(`/api/seasons/${season._id}`)).status).toBe(409);
    await BlogPost.updateOne({ _id: p._id }, { $set: { season: null } });
    expect((await admin.delete(`/api/seasons/${season._id}`)).status).toBe(200);
  });
});

describe("season inicial (R-SEASON-07)", () => {
  // O serviço guarda "já cadastrei" em memória: carrega uma cópia nova para cada uso
  const freshService = () => {
    const path = require.resolve("../../app/services/season.service");
    delete require.cache[path];
    return require(path);
  };
  const DEFAULTS = require("../../app/config/seasons");

  it("cadastra as seasons de config/seasons.js na primeira vez e não duplica", async () => {
    expect(await Season.countDocuments()).toBe(0);
    const { ensureDefaultSeasons } = freshService();
    await ensureDefaultSeasons();
    await ensureDefaultSeasons();
    await freshService().ensureDefaultSeasons();
    const saved = await Season.find().lean();
    expect(saved).toHaveLength(DEFAULTS.length);
    expect(saved[0]).toMatchObject({ slug: DEFAULTS[0].slug, title: DEFAULTS[0].label, order: 0 });
  });

  it("depois de cadastrada, o painel manda: o que foi editado não volta ao padrão", async () => {
    await freshService().ensureDefaultSeasons();
    await Season.updateOne({ slug: DEFAULTS[0].slug }, { $set: { title: "Título editado no painel" } });
    // Outra execução da função (outra instância na Vercel) roda de novo
    await freshService().ensureDefaultSeasons();
    expect((await Season.findOne({ slug: DEFAULTS[0].slug }).lean()).title).toBe("Título editado no painel");
  });

  it("seasonExists reconhece a season inicial e recusa uma inexistente", async () => {
    const { seasonExists } = freshService();
    expect(await seasonExists(DEFAULTS[0].slug)).toBe(true);
    expect(await seasonExists("nao-existe")).toBe(false);
  });
});

describe("tempo de leitura (R-SEASON-08)", () => {
  it("soma dos episódios publicados (~200 palavras/min, mínimo 1 min por episódio)", async () => {
    await Season.create({ title: "Leitura", slug: "leitura" });
    await createPost(published({ title: "Longo", season: "leitura", content: words(400) })); // 2 min
    await createPost(published({ title: "Curto", season: "leitura", content: "<p>Muito curto mesmo.</p>" })); // 1 min (mínimo)
    await createPost({ title: "Rascunho", season: "leitura", content: words(2000) }); // não conta
    await createPost(published({ title: "Lixeira", season: "leitura", content: words(2000), deletedAt: new Date() })); // não conta

    const list = await api().get("/api/seasons");
    expect(list.body.find((s) => s.slug === "leitura").readingMinutes).toBe(3);
    const one = await api().get("/api/seasons/leitura");
    expect(one.body.posts.map((p) => p.readingMinutes).sort()).toEqual([1, 2]);
  });
});
