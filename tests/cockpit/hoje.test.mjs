import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { PANEL_ORIGIN, api, asAdmin, createAdmin, createPost, models, sessionCookie, sign } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const MetricSnapshot = require("../../app/models/metricSnapshot.model");
const JobRun = require("../../app/models/jobRun.model");
const JobDefinition = require("../../app/models/jobDefinition.model");
const { dayKey, addDays } = require("../../app/utils/dates");

const month = () => dayKey().slice(0, 7);

afterEach(() => {
  delete process.env.COCKPIT_META_MENSAL;
});

describe("rotas do painel exigem sessão", () => {
  const routes = [
    ["get", "/api/cockpit/hoje"],
    ["get", "/api/cockpit/jobs"],
    ["get", "/api/cockpit/automacoes"],
    ["get", "/api/cockpit/placar"],
    ["put", "/api/cockpit/placar/metas"],
    ["post", "/api/cockpit/jobs"],
    ["put", "/api/cockpit/jobs/blog-cron-daily"],
    ["get", "/api/cockpit/meta"],
    ["put", "/api/cockpit/meta"],
  ];

  it("sem login, token forjado, sem 2º fator e sessão de leitor: 401 em todas", async () => {
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
});

describe("GET /api/cockpit/hoje", () => {
  it("sem nenhum dado: tudo em 'sem dados', rotinas padrão aparecem", async () => {
    const admin = await asAdmin();
    const res = await admin.get("/api/cockpit/hoje");
    expect(res.status).toBe(200);
    expect(res.body.receita.status).toBe("sem_dados");
    expect(res.body.receita.meta).toBe(15000);
    expect(res.body.prospeccao.hasData).toBe(false);
    expect(res.body.automacoes.jobs.map((j) => j.job)).toEqual(["benchmark-worker", "blog-cron-daily", "prospect-worker", "reports-bot"]);
    // Rotinas que nunca deram sinal entram em "precisa de ação"
    expect(res.body.acoes.items.length).toBe(4);
  });

  it("cada tile traz fonte e atualização", async () => {
    const admin = await asAdmin();
    const body = (await admin.get("/api/cockpit/hoje")).body;
    for (const tile of ["receita", "prospeccao", "leituras", "inscritos", "automacoes", "acoes"]) {
      expect(body[tile].source, tile).toBeTruthy();
      expect("updatedAt" in body[tile], tile).toBe(true);
    }
  });

  it("receita com retrato e meta do ambiente", async () => {
    process.env.COCKPIT_META_MENSAL = "20000";
    await MetricSnapshot.create({ source: "prospect0101", key: "receita_mes", period: month(), value: 1 });
    const admin = await asAdmin();
    const { receita } = (await admin.get("/api/cockpit/hoje")).body;
    expect(receita.meta).toBe(20000);
    expect(receita.accumulated).toBe(1);
    expect(receita.status).toBe("fora");
    expect(receita.updatedAt).toBeTruthy();
  });

  it("meta salva no painel vence a do ambiente", async () => {
    process.env.COCKPIT_META_MENSAL = "20000";
    const admin = await asAdmin();
    expect((await admin.put("/api/cockpit/meta").send({ valor: 9000 })).status).toBe(200);
    expect((await admin.get("/api/cockpit/hoje")).body.receita.meta).toBe(9000);
    expect((await admin.put("/api/cockpit/meta").send({ valor: -1 })).status).toBe(422);
  });

  it("prospecção usa o retrato mais recente de cada chave", async () => {
    await MetricSnapshot.create([
      { source: "prospect0101", key: "contatos_semana", period: "2026-W47", value: 10 },
      { source: "prospect0101", key: "contatos_semana", period: "2026-W48", value: 25 },
      { source: "prospect0101", key: "respostas_semana", period: "2026-W48", value: 4 },
    ]);
    const admin = await asAdmin();
    const p = (await admin.get("/api/cockpit/hoje")).body.prospeccao;
    expect(p).toMatchObject({ contatos: 25, respostas: 4, reunioes: null, hasData: true, period: "2026-W48" });
  });

  it("blog: leituras 7 dias vs 7 anteriores, inscritos ativos e novos no mês", async () => {
    const post = await createPost();
    const today = dayKey();
    await models.PostDailyStat.create([
      { post: post._id, day: today, views: 30 },
      { post: post._id, day: addDays(today, -6), views: 20 },
      { post: post._id, day: addDays(today, -7), views: 25 },
      { post: post._id, day: addDays(today, -13), views: 25 },
      { post: post._id, day: addDays(today, -14), views: 999 },
    ]);
    await models.Subscriber.create([
      { email: "a@x.dev", status: "active" },
      { email: "b@x.dev", status: "unsubscribed" },
    ]);
    const admin = await asAdmin();
    const body = (await admin.get("/api/cockpit/hoje")).body;
    expect(body.leituras).toMatchObject({ views7d: 50, viewsPrev7d: 50, variacaoPct: 0 });
    expect(body.inscritos.ativos).toBe(1);
    expect(body.inscritos.novosMes).toBeGreaterThanOrEqual(1);
  });

  it("rotina atrasada e rotina que falhou viram itens de ação", async () => {
    const admin = await asAdmin();
    await admin.get("/api/cockpit/jobs"); // semeia as definições
    const old = new Date(Date.now() - 3 * 86400000);
    await JobRun.create({ job: "blog-cron-daily", status: "ok", startedAt: old, finishedAt: old });
    await JobRun.create({ job: "prospect-worker", status: "fail", startedAt: new Date(), finishedAt: new Date(), error: "boom" });
    const body = (await admin.get("/api/cockpit/hoje")).body;
    const byJob = Object.fromEntries(body.automacoes.jobs.map((j) => [j.job, j.status]));
    expect(byJob["blog-cron-daily"]).toBe("atrasada");
    expect(byJob["prospect-worker"]).toBe("falhou");
    expect(body.automacoes.falhou).toBe(1);
    expect(body.acoes.items.find((i) => i.id === "job-prospect-worker").detail).toBe("boom");
  });
});

describe("cron do blog registra sinal de vida", () => {
  it("rodar o cron cria execução ok de blog-cron-daily", async () => {
    const res = await api().get("/api/cron/daily").set("Authorization", "Bearer cron-de-teste");
    expect(res.status).toBe(200);
    const run = await JobRun.findOne({ job: "blog-cron-daily" }).lean();
    expect(run.status).toBe("ok");
    const admin = await asAdmin();
    const jobs = (await admin.get("/api/cockpit/hoje")).body.automacoes.jobs;
    expect(jobs.find((j) => j.job === "blog-cron-daily").status).toBe("ok");
  });
});

describe("CRUD de rotinas", () => {
  it("lista, cria e atualiza", async () => {
    const admin = await asAdmin();
    expect((await admin.get("/api/cockpit/jobs")).body.jobs).toHaveLength(4);
    const created = await admin.post("/api/cockpit/jobs").send({ job: "nova-rotina", label: "Nova", expectedEverySec: 600 });
    expect(created.status).toBe(201);
    expect((await admin.post("/api/cockpit/jobs").send({ job: "nova-rotina", label: "Nova", expectedEverySec: 600 })).status).toBe(409);
    const upd = await admin.put("/api/cockpit/jobs/nova-rotina").send({ graceSec: 120 });
    expect(upd.body.job.graceSec).toBe(120);
    expect((await admin.put("/api/cockpit/jobs/nao-existe").send({ graceSec: 1 })).status).toBe(404);
    expect((await admin.post("/api/cockpit/jobs").send({ job: "Ruim Nome", label: "x", expectedEverySec: 600 })).status).toBe(422);
    expect((await admin.post("/api/cockpit/jobs").send({ job: "curta", label: "x", expectedEverySec: 5 })).status).toBe(422);
    expect(await JobDefinition.countDocuments({})).toBe(5);
  });
});
