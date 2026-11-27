import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const { signBody } = require("../../app/utils/cockpitSecurity");
const MetricSnapshot = require("../../app/models/metricSnapshot.model");
const JobRun = require("../../app/models/jobRun.model");
const RateLimit = require("../../app/models/ratelimit.model");
const { evaluateJob, recordRun } = require("../../app/services/cockpitJobs.service");

const SECRET = "segredo-prospect-de-teste";
// Cada chamada usa um segundo diferente: mesmo corpo + mesmo segundo = mesma assinatura (replay)
let tick = 0;
const now = () => String(Math.floor(Date.now() / 1000) - (tick++ % 200));

// Envia como a prospecção enviaria: corpo cru assinado
function send(path, body, { source = "prospect0101", secret = SECRET, ts = now(), raw } = {}) {
  const text = raw ?? JSON.stringify(body);
  return api()
    .post(path)
    .set("Content-Type", "application/json")
    .set("x-cockpit-source", source)
    .set("x-cockpit-timestamp", ts)
    .set("x-cockpit-signature", signBody(secret, ts, text))
    .send(text);
}

const item = (over = {}) => ({ key: "receita_mes", period: "2026-11", value: 4200.5, ...over });
const ingest = (items, opts) => send("/api/cockpit/ingest", { items }, opts);

beforeEach(() => {
  process.env.COCKPIT_INGEST_SECRET_PROSPECT = SECRET;
  process.env.COCKPIT_INGEST_SECRET_BENCHMARK = "segredo-benchmark";
  process.env.COCKPIT_INGEST_SECRET_REPORTS = "";
});
afterEach(() => {
  delete process.env.COCKPIT_INGEST_SECRET_PROSPECT;
  delete process.env.COCKPIT_INGEST_SECRET_BENCHMARK;
  delete process.env.COCKPIT_INGEST_SECRET_REPORTS;
});

describe("ingestão: assinatura HMAC", () => {
  it("assinatura válida grava o retrato", async () => {
    const res = await ingest([item(), item({ key: "contatos_semana", period: "2026-W48", value: 30, meta: { canal: "linkedin" } })]);
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(2);
    const snap = await MetricSnapshot.findOne({ source: "prospect0101", key: "receita_mes" }).lean();
    expect(snap.value).toBe(4200.5);
  });

  it("reenviar outro valor atualiza (upsert), sem duplicar", async () => {
    await ingest([item({ value: 1 })]);
    await ingest([item({ value: 2 })]);
    expect(await MetricSnapshot.countDocuments({})).toBe(1);
    expect((await MetricSnapshot.findOne({}).lean()).value).toBe(2);
  });

  it("assinatura errada: 401 e nada gravado", async () => {
    const res = await ingest([item()], { secret: "outro-segredo" });
    expect(res.status).toBe(401);
    expect(await MetricSnapshot.countDocuments({})).toBe(0);
  });

  it("corpo alterado depois de assinar: 401", async () => {
    const ts = now();
    const res = await api()
      .post("/api/cockpit/ingest")
      .set("Content-Type", "application/json")
      .set("x-cockpit-source", "prospect0101")
      .set("x-cockpit-timestamp", ts)
      .set("x-cockpit-signature", signBody(SECRET, ts, JSON.stringify({ items: [item({ value: 1 })] })))
      .send(JSON.stringify({ items: [item({ value: 999999 })] }));
    expect(res.status).toBe(401);
  });

  it("sem cabeçalhos de assinatura: 400/401", async () => {
    const res = await api().post("/api/cockpit/ingest").send({ items: [item()] });
    expect([400, 401]).toContain(res.status);
  });

  it("segredo de outra fonte não vale: 401", async () => {
    const res = await ingest([{ key: "analises_semana", period: "2026-W48", value: 3 }], { source: "benchmark0101", secret: SECRET });
    expect(res.status).toBe(401);
  });

  it("fonte desconhecida: 400; fonte sem segredo configurado: 503", async () => {
    expect((await ingest([item()], { source: "qualquer" })).status).toBe(400);
    expect((await ingest([item({ key: "relatorios_enviados_semana" })], { source: "reports", secret: "x" })).status).toBe(503);
  });

  it("timestamp expirado ou do futuro (±5 min): 401", async () => {
    const old = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const future = String(Math.floor(Date.now() / 1000) + 6 * 60);
    expect((await ingest([item()], { ts: old })).status).toBe(401);
    expect((await ingest([item()], { ts: future })).status).toBe(401);
    expect((await ingest([item()], { ts: String(Math.floor(Date.now() / 1000) - 4 * 60) })).status).toBe(200);
  });

  it("mesmo pedido assinado enviado duas vezes (replay): o segundo é 401", async () => {
    const ts = now();
    const text = JSON.stringify({ items: [item()] });
    const first = await send("/api/cockpit/ingest", null, { ts, raw: text });
    const second = await send("/api/cockpit/ingest", null, { ts, raw: text });
    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
  });
});

describe("ingestão: validação estrita", () => {
  it("chave fora da lista da fonte: 422", async () => {
    const res = await ingest([item({ key: "chave_inventada" })]);
    expect(res.status).toBe(422);
    expect(await MetricSnapshot.countDocuments({})).toBe(0);
  });

  it("chave de outra fonte: 422 (benchmark não grava receita)", async () => {
    const res = await ingest([item()], { source: "benchmark0101", secret: "segredo-benchmark" });
    expect(res.status).toBe(422);
  });

  it("valor que não é número: 422", async () => {
    expect((await ingest([item({ value: "4200" })])).status).toBe(422);
  });

  it("campo desconhecido no item ou no corpo: 422", async () => {
    expect((await ingest([item({ extra: 1 })])).status).toBe(422);
    expect((await send("/api/cockpit/ingest", { items: [item()], x: 1 })).status).toBe(422);
  });

  it("período inválido: 422", async () => {
    expect((await ingest([item({ period: "novembro" })])).status).toBe(422);
    expect((await ingest([item({ period: "2026-13" })])).status).toBe(422);
  });

  it("até 200 itens: 200 passa, 201 é 422", async () => {
    const mk = (n) => Array.from({ length: n }, (_, i) => item({ period: `2025-W${String((i % 52) + 1).padStart(2, "0")}`, key: ["receita_mes", "contatos_semana", "respostas_semana", "reunioes_semana"][Math.floor(i / 52)] }));
    expect((await ingest(mk(200))).status).toBe(200);
    expect((await ingest(mk(201))).status).toBe(422);
  });

  it("corpo acima de 32 KB: 413", async () => {
    const res = await ingest([item({ meta: { nota: "x".repeat(40) } })], { raw: JSON.stringify({ items: [item()], pad: "a".repeat(33 * 1024) }) });
    expect(res.status).toBe(413);
  });
});

describe("ingestão: dado de pessoa é recusado", () => {
  const cases = {
    email: "contato: joao@empresa.com.br",
    "telefone com máscara": "(11) 91234-5678",
    "telefone só dígitos": "5511912345678",
    CPF: "123.456.789-09",
    CNPJ: "12.345.678/0001-95",
  };
  for (const [name, text] of Object.entries(cases)) {
    it(`${name} em meta: 422 e nada gravado`, async () => {
      const res = await ingest([item({ meta: { nota: text } })]);
      expect(res.status).toBe(422);
      expect(await MetricSnapshot.countDocuments({})).toBe(0);
    });
  }

  it("em campo desconhecido também (varre tudo): 422", async () => {
    const res = await send("/api/cockpit/ingest", { items: [item()], observacao: "fale com maria@x.com" });
    expect(res.status).toBe(422);
  });

  it("número com 10+ dígitos como valor: 422", async () => {
    expect((await ingest([item({ value: 11912345678 })])).status).toBe(422);
  });

  it("texto comum e números normais passam", async () => {
    const res = await ingest([item({ meta: { canal: "linkedin", janela: "7 dias" } })]);
    expect(res.status).toBe(200);
  });
});

describe("limite de pedidos", () => {
  it("passou de 60 por minuto: 429", async () => {
    await RateLimit.create({ key: "cockpit-machine:::ffff:127.0.0.1", count: 60, expiresAt: new Date(Date.now() + 60000) });
    await RateLimit.create({ key: "cockpit-machine:127.0.0.1", count: 60, expiresAt: new Date(Date.now() + 60000) });
    await RateLimit.create({ key: "cockpit-machine:unknown", count: 60, expiresAt: new Date(Date.now() + 60000) });
    const res = await ingest([item()]);
    expect(res.status).toBe(429);
  });
});

describe("sinal de vida (heartbeat)", () => {
  const beat = (job, body, opts) => send(`/api/cockpit/heartbeat/${job}`, body, opts);

  it("start e ok: fecha a execução aberta com duração", async () => {
    expect((await beat("prospect-worker", { status: "start" })).status).toBe(200);
    expect((await beat("prospect-worker", { status: "ok", items: 12 })).status).toBe(200);
    const runs = await JobRun.find({ job: "prospect-worker" }).lean();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "ok", items: 12 });
    expect(runs[0].finishedAt).toBeTruthy();
  });

  it("fail grava o erro (máx. 500)", async () => {
    expect((await beat("prospect-worker", { status: "fail", error: "timeout no provedor" })).status).toBe(200);
    expect((await JobRun.findOne({ job: "prospect-worker" }).lean()).error).toBe("timeout no provedor");
    expect((await beat("prospect-worker", { status: "fail", error: "x".repeat(501) })).status).toBe(422);
  });

  it("rotina desconhecida: 404; rotina de outra fonte: 403", async () => {
    expect((await beat("nao-existe", { status: "ok" })).status).toBe(404);
    expect((await beat("benchmark-worker", { status: "ok" })).status).toBe(403);
    expect((await beat("blog-cron-daily", { status: "ok" })).status).toBe(403);
  });

  it("estado inválido ou erro com e-mail: 422", async () => {
    expect((await beat("prospect-worker", { status: "talvez" })).status).toBe(422);
    expect((await beat("prospect-worker", { status: "fail", error: "falhou para a@b.com" })).status).toBe(422);
  });

  it("assinatura inválida: 401", async () => {
    expect((await beat("prospect-worker", { status: "ok" }, { secret: "errado" })).status).toBe(401);
  });
});

describe("estado das rotinas (ok / atrasada / falhou / rodando)", () => {
  const def = { job: "j", label: "J", expectedEverySec: 3600, graceSec: 600 };
  const at = (minAgo, extra = {}) => ({ startedAt: new Date(Date.now() - minAgo * 60000), finishedAt: new Date(Date.now() - minAgo * 60000), ...extra });

  it("ok dentro do prazo", () => {
    expect(evaluateJob(def, { lastOk: at(30) }).status).toBe("ok");
  });

  it("atrasada só depois de esperado + folga (70 min)", () => {
    expect(evaluateJob(def, { lastOk: at(69) }).status).toBe("ok");
    expect(evaluateJob(def, { lastOk: at(71) }).status).toBe("atrasada");
  });

  it("nunca deu sinal: atrasada, marcada neverRan", () => {
    const s = evaluateJob(def, {});
    expect(s.status).toBe("atrasada");
    expect(s.neverRan).toBe(true);
  });

  it("falha mais nova que o último ok: falhou (com o erro)", () => {
    const s = evaluateJob(def, { lastOk: at(50), lastFail: at(5, { error: "boom" }) });
    expect(s.status).toBe("falhou");
    expect(s.lastError).toBe("boom");
  });

  it("ok mais novo que a falha: volta a ok", () => {
    expect(evaluateJob(def, { lastOk: at(2), lastFail: at(20) }).status).toBe("ok");
  });

  it("início recente sem fim: rodando; início antigo não segura", () => {
    expect(evaluateJob(def, { lastOk: at(30), open: { startedAt: new Date(Date.now() - 60000) } }).status).toBe("rodando");
    expect(evaluateJob(def, { lastOk: at(300), open: { startedAt: new Date(Date.now() - 3 * 3600000) } }).status).toBe("atrasada");
  });

  it("recordRun sem start anterior cria execução já fechada", async () => {
    await recordRun("prospect-worker", { status: "ok", durationMs: 2000 });
    const run = await JobRun.findOne({ job: "prospect-worker" }).lean();
    expect(run.durationMs).toBe(2000);
    expect(run.finishedAt).toBeTruthy();
  });
});

describe("JobRun", () => {
  it("tem índice TTL de 90 dias", async () => {
    await JobRun.init();
    const idx = (await JobRun.collection.indexes()).find((i) => i.expireAfterSeconds !== undefined);
    expect(idx).toBeTruthy();
    expect(idx.key).toEqual({ startedAt: 1 });
    expect(idx.expireAfterSeconds).toBe(90 * 24 * 60 * 60);
  });

  it("MetricSnapshot tem índice único (fonte, chave, período)", async () => {
    await MetricSnapshot.init();
    const idx = (await MetricSnapshot.collection.indexes()).find((i) => i.unique && i.key.source === 1);
    expect(idx.key).toEqual({ source: 1, key: 1, period: 1 });
  });
});
