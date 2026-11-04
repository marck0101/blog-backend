import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asAdmin, createPost } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const { DAILY_JOB_UTC_HOUR } = require("../../app/config/schedule");
const { firstSchedulableDay } = require("../../app/controllers/posts/post.rules");

// BIZ-01 / R-POST-16: agendar só para um dia em que a rotina diária (~9h) ainda vai rodar
const CONTENT = "<p>Conteúdo com mais de dez caracteres.</p>";
const BEFORE_9H = new Date("2026-11-10T11:30:00Z"); // 8h30 em Brasília
const AFTER_9H = new Date("2026-11-10T13:00:00Z"); // 10h em Brasília

describe("horário da rotina diária", () => {
  it("o horário do código é o mesmo do cron no vercel.json", () => {
    const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
    const daily = vercel.crons.find((c) => c.path === "/api/cron/daily");
    expect(daily.schedule).toBe(`0 ${DAILY_JOB_UTC_HOUR} * * *`);
  });

  it("primeiro dia possível: hoje antes das 9h, amanhã depois", () => {
    expect(firstSchedulableDay(BEFORE_9H)).toBe("2026-11-10");
    expect(firstSchedulableDay(AFTER_9H)).toBe("2026-11-11");
  });
});

describe("agendar pela API", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  const schedule = (admin, plannedAt) =>
    admin.post("/api/posts").send({ title: "Agendado", category: "growth", status: "planned", plannedAt, content: CONTENT });

  it("hoje, antes das 9h: aceita (sai na rotina de hoje)", async () => {
    vi.setSystemTime(BEFORE_9H);
    const admin = await asAdmin();
    expect((await schedule(admin, "2026-11-10")).status).toBe(201);
  });

  it("hoje, depois das 9h: recusa e explica", async () => {
    vi.setSystemTime(AFTER_9H);
    const admin = await asAdmin();
    const res = await schedule(admin, "2026-11-10");
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/já rodou/);
  });

  it("amanhã, depois das 9h: aceita", async () => {
    vi.setSystemTime(AFTER_9H);
    const admin = await asAdmin();
    expect((await schedule(admin, "2026-11-11")).status).toBe(201);
  });

  it("data passada: recusa", async () => {
    vi.setSystemTime(BEFORE_9H);
    const admin = await asAdmin();
    const res = await schedule(admin, "2026-11-01");
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/já passou/);
  });

  it("editar um agendado atrasado sem mexer na data continua permitido", async () => {
    vi.setSystemTime(AFTER_9H);
    const admin = await asAdmin();
    const post = await createPost({ status: "planned", plannedAt: new Date("2026-11-08T12:00:00Z") });
    const res = await admin.put(`/api/posts/${post._id}`).send({ title: "Corrigindo o título", plannedAt: "2026-11-08", status: "planned" });
    expect(res.status).toBe(200);
  });

  it("mudar a data de um agendado para hoje depois das 9h: recusa", async () => {
    vi.setSystemTime(AFTER_9H);
    const admin = await asAdmin();
    const post = await createPost({ status: "planned", plannedAt: new Date("2026-11-20T12:00:00Z") });
    const res = await admin.put(`/api/posts/${post._id}`).send({ plannedAt: "2026-11-10" });
    expect(res.status).toBe(422);
  });

  it("rascunho com data no calendário passada continua livre (não é agendamento)", async () => {
    vi.setSystemTime(AFTER_9H);
    const admin = await asAdmin();
    const res = await admin.post("/api/posts").send({ title: "Ideia", category: "growth", status: "draft", plannedAt: "2026-11-01" });
    expect(res.status).toBe(201);
  });
});
