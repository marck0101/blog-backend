import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { PANEL_ORIGIN, api, asAdmin, createAdmin, sessionCookie, sign } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const Experiment = require("../../app/models/experiment.model");
const CockpitLink = require("../../app/models/cockpitLink.model");

const ID = "64b7f0c2a1b2c3d4e5f60718";
const future = () => new Date(Date.now() + 7 * 86400000).toISOString();
const base = (over = {}) => ({
  title: "Título do post com número",
  hypothesis: "Se o título tiver número, então o clique sobe, porque promete algo concreto",
  area: "conteudo",
  ice: { impact: 4, confidence: 3, ease: 5 },
  ...over,
});
const ready = (over = {}) =>
  base({ metric: "CTR", plannedEnd: future(), variants: [{ name: "A" }, { name: "B", description: "com número" }], ...over });

describe("rotas de experimentos e links exigem sessão", () => {
  const routes = [
    ["get", "/api/cockpit/experiments"],
    ["post", "/api/cockpit/experiments"],
    ["put", `/api/cockpit/experiments/${ID}`],
    ["post", `/api/cockpit/experiments/${ID}/transition`],
    ["delete", `/api/cockpit/experiments/${ID}`],
    ["get", "/api/cockpit/links"],
    ["post", "/api/cockpit/links"],
    ["put", `/api/cockpit/links/${ID}`],
    ["delete", `/api/cockpit/links/${ID}`],
  ];

  it("sem login, token forjado, sem 2º fator e leitor: 401", async () => {
    const user = await createAdmin();
    const credentials = [
      {},
      { Cookie: "admin_session=lixo" },
      { Cookie: sessionCookie(user, { mfa: false }) },
      { Cookie: `admin_session=${sign({ purpose: "reader", sub: "g-1" }, "1h")}` },
    ];
    for (const [method, url] of routes) {
      for (const headers of credentials) {
        const res = await api()[method](url).set({ Origin: PANEL_ORIGIN, ...headers }).send({});
        expect(res.status, `${method} ${url}`).toBe(401);
      }
    }
  });

  it("escrita com origem não permitida: 403", async () => {
    const user = await createAdmin();
    const cookie = sessionCookie(user);
    for (const [method, url] of routes.filter(([m]) => m !== "get")) {
      const res = await api()[method](url).set({ Cookie: cookie, Origin: "https://evil.example" }).send({});
      expect(res.status, `${method} ${url}`).toBe(403);
    }
  });
});

describe("experimentos: CRUD e validação", () => {
  it("cria com ICE calculado e lista ordenado por ICE", async () => {
    const admin = await asAdmin();
    const a = await admin.post("/api/cockpit/experiments").send(base({ title: "Baixo", ice: { impact: 1, confidence: 1, ease: 2 } }));
    expect(a.status).toBe(201);
    expect(a.body.experiment.iceScore).toBe(2);
    expect(a.body.experiment.status).toBe("ideia");
    const b = await admin.post("/api/cockpit/experiments").send(base());
    expect(b.body.experiment.iceScore).toBe(60);
    const list = (await admin.get("/api/cockpit/experiments")).body.experiments;
    expect(list.map((e) => e.iceScore)).toEqual([60, 2]);
  });

  it("filtra por status e área; recusa filtro inválido", async () => {
    const admin = await asAdmin();
    await admin.post("/api/cockpit/experiments").send(base({ area: "email" }));
    await admin.post("/api/cockpit/experiments").send(base({ area: "site" }));
    expect((await admin.get("/api/cockpit/experiments?area=email")).body.experiments).toHaveLength(1);
    expect((await admin.get("/api/cockpit/experiments?status=rodando")).body.experiments).toHaveLength(0);
    expect((await admin.get("/api/cockpit/experiments?status=xx")).status).toBe(422);
  });

  it("recusa dados inválidos", async () => {
    const admin = await asAdmin();
    const bad = [
      base({ hypothesis: "vamos testar o título" }),
      base({ area: "outra" }),
      base({ ice: { impact: 6, confidence: 3, ease: 5 } }),
      base({ ice: { impact: 0, confidence: 3, ease: 5 } }),
      base({ ice: { impact: 2.5, confidence: 3, ease: 5 } }),
      base({ title: "ab" }),
      base({ plannedEnd: "não é data" }),
      base({ status: "concluido" }),
      base({ $set: { deletedAt: null } }),
      { title: "sem nada" },
    ];
    for (const body of bad) {
      expect((await admin.post("/api/cockpit/experiments").send(body)).status, JSON.stringify(body)).toBe(422);
    }
    expect(await Experiment.countDocuments({})).toBe(0);
  });

  it("atualiza campos (recalcula ICE), mas não muda status por aqui", async () => {
    const admin = await asAdmin();
    const { experiment } = (await admin.post("/api/cockpit/experiments").send(base())).body;
    const upd = await admin.put(`/api/cockpit/experiments/${experiment._id}`).send({ ice: { impact: 5, confidence: 5, ease: 5 }, channel: "LinkedIn" });
    expect(upd.status).toBe(200);
    expect(upd.body.experiment.iceScore).toBe(125);
    expect(upd.body.experiment.channel).toBe("LinkedIn");
    expect((await admin.put(`/api/cockpit/experiments/${experiment._id}`).send({ status: "rodando" })).status).toBe(422);
    expect((await admin.put(`/api/cockpit/experiments/${experiment._id}`).send({})).status).toBe(422);
    expect((await admin.put(`/api/cockpit/experiments/${ID}`).send({ channel: "x" })).status).toBe(404);
    expect((await admin.put("/api/cockpit/experiments/abc").send({ channel: "x" })).status).toBe(422);
  });

  it("exclusão é lógica: some da lista e não aceita mais edição", async () => {
    const admin = await asAdmin();
    const { experiment } = (await admin.post("/api/cockpit/experiments").send(base())).body;
    expect((await admin.delete(`/api/cockpit/experiments/${experiment._id}`)).status).toBe(200);
    expect((await admin.get("/api/cockpit/experiments")).body.experiments).toHaveLength(0);
    expect(await Experiment.countDocuments({})).toBe(1);
    expect((await Experiment.findById(experiment._id)).deletedAt).toBeTruthy();
    expect((await admin.delete(`/api/cockpit/experiments/${experiment._id}`)).status).toBe(404);
    expect((await admin.post(`/api/cockpit/experiments/${experiment._id}/transition`).send({ status: "planejado" })).status).toBe(404);
  });
});

describe("experimentos: regras de status", () => {
  const create = async (admin, body) => (await admin.post("/api/cockpit/experiments").send(body)).body.experiment;
  const go = (admin, id, status, result) => admin.post(`/api/cockpit/experiments/${id}/transition`).send({ status, ...(result ? { result } : {}) });

  it("transição fora do mapa é recusada", async () => {
    const admin = await asAdmin();
    const e = await create(admin, ready());
    expect((await go(admin, e._id, "concluido")).status).toBe(422);
    expect((await go(admin, e._id, "analisando")).status).toBe(422);
    expect((await go(admin, e._id, "ideia")).status).toBe(422);
    expect((await go(admin, e._id, "planejado")).status).toBe(200);
  });

  it("rodando exige métrica, data prevista e 2 variantes", async () => {
    const admin = await asAdmin();
    const e = await create(admin, base({ variants: [{ name: "A" }] }));
    await go(admin, e._id, "planejado");
    const res = await go(admin, e._id, "rodando");
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/métrica principal/);
    expect(res.body.error).toMatch(/data prevista/);
    expect(res.body.error).toMatch(/2 variantes/);
    await admin.put(`/api/cockpit/experiments/${e._id}`).send({ metric: "CTR", plannedEnd: future(), variants: [{ name: "A" }, { name: "B" }] });
    const ok = await go(admin, e._id, "rodando");
    expect(ok.status).toBe(200);
    expect(ok.body.experiment.startedAt).toBeTruthy();
    expect(ok.body.experiment.finishedAt).toBeNull();
  });

  it("concluir exige resumo, decisão e aprendizado; grava finishedAt", async () => {
    const admin = await asAdmin();
    const e = await create(admin, ready());
    await go(admin, e._id, "planejado");
    await go(admin, e._id, "rodando");
    expect((await go(admin, e._id, "analisando")).status).toBe(200);

    const none = await go(admin, e._id, "concluido");
    expect(none.status).toBe(422);
    expect(none.body.error).toMatch(/resumo.*decisão.*aprendizado/);
    expect((await go(admin, e._id, "concluido", { summary: "B ganhou", decision: "adotar" })).status).toBe(422);
    expect((await go(admin, e._id, "concluido", { summary: "B ganhou", decision: "talvez", learning: "x" })).status).toBe(422);

    const done = await go(admin, e._id, "concluido", { summary: "B ganhou", valueA: 2.1, valueB: 3.4, sample: 500, decision: "adotar", learning: "Número no título funciona" });
    expect(done.status).toBe(200);
    expect(done.body.experiment.status).toBe("concluido");
    expect(done.body.experiment.finishedAt).toBeTruthy();
    expect(done.body.experiment.result).toMatchObject({ decision: "adotar", valueB: 3.4 });
  });

  it("resultado salvo antes (PUT) vale na conclusão; reabrir limpa finishedAt", async () => {
    const admin = await asAdmin();
    const e = await create(admin, ready());
    for (const s of ["planejado", "rodando", "analisando"]) await go(admin, e._id, s);
    await admin.put(`/api/cockpit/experiments/${e._id}`).send({ result: { summary: "ok", decision: "repetir", learning: "amostra pequena" } });
    expect((await go(admin, e._id, "concluido")).status).toBe(200);
    const reopened = await go(admin, e._id, "analisando");
    expect(reopened.status).toBe(200);
    expect(reopened.body.experiment.finishedAt).toBeNull();
  });

  it("descartar grava finishedAt; startedAt é mantido ao voltar de analisando", async () => {
    const admin = await asAdmin();
    const e = await create(admin, ready());
    for (const s of ["planejado", "rodando"]) await go(admin, e._id, s);
    const started = (await Experiment.findById(e._id)).startedAt;
    await go(admin, e._id, "analisando");
    const back = await go(admin, e._id, "rodando");
    expect(new Date(back.body.experiment.startedAt).getTime()).toBe(started.getTime());
    const dropped = await go(admin, e._id, "descartado");
    expect(dropped.body.experiment.finishedAt).toBeTruthy();
  });
});

describe("Hoje: experimentos rodando vencidos", () => {
  it("entram em 'precisa de ação' só se passaram da data e estão rodando", async () => {
    const admin = await asAdmin();
    const past = new Date(Date.now() - 2 * 86400000);
    await Experiment.create([
      { ...base({ title: "Vencido" }), status: "rodando", plannedEnd: past },
      { ...base({ title: "No prazo" }), status: "rodando", plannedEnd: new Date(Date.now() + 86400000) },
      { ...base({ title: "Ideia antiga" }), status: "ideia", plannedEnd: past },
      { ...base({ title: "Apagado" }), status: "rodando", plannedEnd: past, deletedAt: new Date() },
    ]);
    const item = (await admin.get("/api/cockpit/hoje")).body.acoes.items.find((i) => i.id === "experimentos-vencidos");
    expect(item.count).toBe(1);
    expect(item.detail).toBe("Vencido");
  });
});

describe("links", () => {
  it("CRUD completo, ordenado por grupo e ordem", async () => {
    const admin = await asAdmin();
    const a = await admin.post("/api/cockpit/links").send({ label: "GA4", url: "https://analytics.google.com/", group: "analytics" });
    expect(a.status).toBe(201);
    await admin.post("/api/cockpit/links").send({ label: "Meta Ads", url: "https://adsmanager.facebook.com/", group: "anuncios", note: "conta principal", order: 2 });
    await admin.post("/api/cockpit/links").send({ label: "Google Ads", url: "https://ads.google.com/", group: "anuncios", order: 1 });
    const list = (await admin.get("/api/cockpit/links")).body.links;
    expect(list.map((l) => l.label)).toEqual(["Google Ads", "Meta Ads", "GA4"]);
    const upd = await admin.put(`/api/cockpit/links/${a.body.link._id}`).send({ label: "GA4 (site)", group: "outros" });
    expect(upd.body.link).toMatchObject({ label: "GA4 (site)", group: "outros" });
    expect((await admin.delete(`/api/cockpit/links/${a.body.link._id}`)).status).toBe(200);
    expect((await admin.delete(`/api/cockpit/links/${a.body.link._id}`)).status).toBe(404);
    expect(await CockpitLink.countDocuments({})).toBe(2);
  });

  it("recusa http, javascript:, data:, sem protocolo e credenciais na URL", async () => {
    const admin = await asAdmin();
    const urls = [
      "http://exemplo.com",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "exemplo.com/pagina",
      "//exemplo.com",
      "ftp://exemplo.com",
      "https://",
      "https://user:senha@exemplo.com",
      "",
    ];
    for (const url of urls) {
      expect((await admin.post("/api/cockpit/links").send({ label: "x", url })).status, url).toBe(422);
    }
    const ok = await admin.post("/api/cockpit/links").send({ label: "ok", url: "https://exemplo.com" });
    for (const url of urls) {
      expect((await admin.put(`/api/cockpit/links/${ok.body.link._id}`).send({ url })).status, url).toBe(422);
    }
    expect(await CockpitLink.countDocuments({})).toBe(1);
  });

  it("recusa grupo desconhecido e campo extra", async () => {
    const admin = await asAdmin();
    expect((await admin.post("/api/cockpit/links").send({ label: "x", url: "https://a.com", group: "xx" })).status).toBe(422);
    expect((await admin.post("/api/cockpit/links").send({ label: "x", url: "https://a.com", _id: ID })).status).toBe(422);
  });
});
