import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asAdmin, createPost, models } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const { calendarRange } = require("../../app/utils/calendarRange");

// DUP-06: rotas que contam por dia/mês usam o fuso de Brasília, não o do servidor.
// Relógio às 22h de 31/10 em Brasília (01:00 de 01/11 em UTC). Só Date é
// simulado: o MongoDB em memória continua com os timers reais.
const LATE_NIGHT_BR = new Date("2026-11-01T01:00:00Z");

describe("rotas no fuso de Brasília", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(LATE_NIGHT_BR);
  });
  afterEach(() => vi.useRealTimers());

  it("Dashboard: às 22h do dia 31, 'este mês' ainda é outubro (em UTC já seria novembro)", async () => {
    const admin = await asAdmin();
    await createPost({ status: "published", published: true, publishedAt: new Date("2026-10-15T12:00:00Z") });
    await createPost({ title: "Setembro", status: "published", published: true, publishedAt: new Date("2026-09-15T12:00:00Z") });
    const res = await admin.get("/api/dashboard/stats");
    expect(res.body.publishedThisMonth).toBe(1);
    expect(res.body.publishedLastMonth).toBe(1);
  });

  it("Heatmap: o dia é o de Brasília", async () => {
    const admin = await asAdmin();
    await createPost({ status: "published", published: true, publishedAt: new Date("2026-11-01T00:30:00Z") });
    const res = await admin.get("/api/posts/heatmap?year=2026");
    expect(res.body).toEqual({ "2026-10-31": 1 });
  });

  it("Agendados de hoje: 'hoje' é o dia de Brasília", async () => {
    const admin = await asAdmin();
    await createPost({ title: "Hoje", status: "planned", plannedAt: new Date("2026-10-31T12:00:00Z") });
    await createPost({ title: "Amanhã", status: "planned", plannedAt: new Date("2026-11-01T12:00:00Z") });
    const res = await admin.get("/api/posts/today-planned");
    expect(res.body.map((p) => p.title)).toEqual(["Hoje"]);
  });
});

describe("filtros 'de / até' das listas", () => {
  it("posts do painel: o dia inteiro de Brasília, inclusive 22h", async () => {
    const admin = await asAdmin();
    const post = await createPost({ title: "Noite" });
    // Direto na coleção: o Mongoose não deixa mudar createdAt (é imutável)
    await models.BlogPost.collection.updateOne({ _id: post._id }, { $set: { createdAt: new Date("2026-11-01T01:00:00Z") } });
    const res = await admin.get("/api/posts?dateFrom=2026-10-31&dateTo=2026-10-31");
    expect(res.body.posts.map((p) => p.title)).toEqual(["Noite"]);
  });

  it("assinantes: mesmo critério", async () => {
    const admin = await asAdmin();
    const sub = await models.Subscriber.create({ email: "noite@x.dev" });
    await models.Subscriber.collection.updateOne({ _id: sub._id }, { $set: { createdAt: new Date("2026-11-01T01:00:00Z") } });
    const inside = await admin.get("/api/subscribers?dateFrom=2026-10-31&dateTo=2026-10-31");
    const outside = await admin.get("/api/subscribers?dateFrom=2026-11-01&dateTo=2026-11-01");
    expect(inside.body.total).toBe(1);
    expect(outside.body.total).toBe(0);
  });

  it("blog público: data inválida é ignorada (antes virava erro)", async () => {
    const { api } = await import("../helpers.mjs");
    await createPost({ status: "published", published: true, publishedAt: new Date() });
    const res = await api().get("/api/posts/published?dateFrom=ontem");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });
});

describe("calendarRange", () => {
  it("período: dias de Brasília com 1 dia de folga em cada ponta", () => {
    const { start, end } = calendarRange({ from: "2026-11-01", to: "2026-11-07" });
    expect(start.toISOString()).toBe("2026-10-31T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-09T02:59:59.999Z");
  });

  it("período de anos é cortado em 366 dias", () => {
    const { end } = calendarRange({ from: "2026-01-01", to: "2030-01-01" });
    expect(end < new Date("2027-01-05T00:00:00Z")).toBe(true);
  });

  it("formato antigo ?year=&month= dá o mês inteiro", () => {
    const { start, end } = calendarRange({ year: "2026", month: "2" });
    expect(start.toISOString()).toBe("2026-02-01T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-01T02:59:59.999Z");
  });

  it("parâmetro inválido cai no mês atual, sem erro", () => {
    const { start } = calendarRange({ from: { $gt: "" }, to: "x", month: "13" });
    expect(start).toBeInstanceOf(Date);
    expect(Number.isNaN(start.getTime())).toBe(false);
  });
});
