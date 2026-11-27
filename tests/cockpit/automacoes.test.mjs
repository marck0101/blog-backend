import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { asAdmin } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const JobRun = require("../../app/models/jobRun.model");
const { evaluateJob } = require("../../app/services/cockpitJobs.service");

const def = { job: "x", label: "X", expectedEverySec: 3600, graceSec: 600 };
const T0 = new Date("2026-11-27T12:00:00Z");
const ok = (finishedAt) => ({ status: "ok", finishedAt, startedAt: finishedAt });
const limit = (lastOk) => new Date(lastOk.getTime() + (3600 + 600) * 1000);

describe("estado da rotina: bordas do prazo (R-COCKPIT-04)", () => {
  it("exatamente no prazo ainda é ok; 1 ms depois é atrasada", () => {
    expect(evaluateJob(def, { lastOk: ok(T0) }, limit(T0)).status).toBe("ok");
    expect(evaluateJob(def, { lastOk: ok(T0) }, new Date(limit(T0).getTime() + 1)).status).toBe("atrasada");
  });

  it("sem nenhuma execução: atrasada e neverRan", () => {
    const s = evaluateJob(def, {}, T0);
    expect(s.status).toBe("atrasada");
    expect(s.neverRan).toBe(true);
  });

  it("falha mais nova que o último ok: falhou, mesmo dentro do prazo", () => {
    const fail = { status: "fail", finishedAt: new Date(T0.getTime() + 1000), startedAt: T0, error: "boom" };
    const s = evaluateJob(def, { lastOk: ok(T0), lastFail: fail }, new Date(T0.getTime() + 2000));
    expect(s.status).toBe("falhou");
    expect(s.lastError).toBe("boom");
  });

  it("falha antiga e ok depois: volta a ok", () => {
    const fail = { status: "fail", finishedAt: T0, startedAt: T0 };
    const s = evaluateJob(def, { lastOk: ok(new Date(T0.getTime() + 1000)), lastFail: fail }, new Date(T0.getTime() + 2000));
    expect(s.status).toBe("ok");
  });
});

describe("GET /api/cockpit/automacoes", () => {
  it("lista as 4 rotinas; sem execução o status é nunca_rodou", async () => {
    const admin = await asAdmin();
    const res = await admin.get("/api/cockpit/automacoes");
    expect(res.status).toBe(200);
    expect(res.body.jobs.map((j) => j.job)).toEqual(["benchmark-worker", "blog-cron-daily", "prospect-worker", "reports-bot"]);
    expect(res.body.jobs.every((j) => j.status === "nunca_rodou" && j.runs.length === 0)).toBe(true);
  });

  it("devolve só as 10 últimas execuções, da mais nova para a mais antiga, com duração", async () => {
    const now = Date.now();
    await JobRun.create(
      Array.from({ length: 12 }, (_, i) => ({
        job: "reports-bot",
        status: "ok",
        startedAt: new Date(now - (12 - i) * 60000),
        finishedAt: new Date(now - (12 - i) * 60000 + 500),
        durationMs: 500 + i,
      }))
    );
    const admin = await asAdmin();
    const job = (await admin.get("/api/cockpit/automacoes")).body.jobs.find((j) => j.job === "reports-bot");
    expect(job.runs).toHaveLength(10);
    expect(job.runs[0].durationMs).toBe(511);
    expect(job.status).toBe("ok");
  });

  it("falha e atraso viram alerta na página Hoje", async () => {
    await JobRun.create({ job: "reports-bot", status: "fail", startedAt: new Date(), finishedAt: new Date(), durationMs: 5, error: "erro de teste" });
    const old = new Date(Date.now() - 86400000);
    await JobRun.create({ job: "prospect-worker", status: "ok", startedAt: old, finishedAt: old });
    const admin = await asAdmin();
    const items = (await admin.get("/api/cockpit/hoje")).body.acoes.items;
    expect(items.find((i) => i.id === "job-reports-bot")?.title).toMatch(/falhou/);
    expect(items.find((i) => i.id === "job-prospect-worker")?.title).toMatch(/atrasada/);
  });
});
