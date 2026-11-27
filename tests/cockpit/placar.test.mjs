import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { api, asAdmin, createPost, models } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const MetricSnapshot = require("../../app/models/metricSnapshot.model");
const { mondayOf, weekKeyOf, lastWeeks } = require("../../app/utils/weeks");
const { compare } = require("../../app/services/cockpitPlacar.service");
const { buildMorningText, sendMorningSummary, chatAllowed, telegramConfig } = require("../../app/services/cockpitTelegram.service");

describe("semanas (segunda a domingo, Brasília)", () => {
  it("segunda-feira e chave ISO", () => {
    expect(mondayOf("2026-11-27")).toBe("2026-11-23"); // sexta
    expect(mondayOf("2026-11-29")).toBe("2026-11-23"); // domingo fecha a semana
    expect(mondayOf("2026-11-30")).toBe("2026-11-30");
    expect(weekKeyOf("2026-11-27")).toBe("2026-W48");
  });

  it("virada de ano: 1/1/2027 ainda é W53 de 2026; 4/1/2027 abre 2027-W01", () => {
    expect(weekKeyOf("2027-01-01")).toBe("2026-W53");
    expect(weekKeyOf("2027-01-03")).toBe("2026-W53");
    expect(weekKeyOf("2027-01-04")).toBe("2027-W01");
    expect(weekKeyOf("2024-12-30")).toBe("2025-W01");
  });

  it("13 semanas, a atual por último; domingo 22h30 em Brasília ainda é a mesma semana", () => {
    const w = lastWeeks(new Date("2026-11-30T01:30:00Z")); // domingo 29/11 22h30 em Brasília
    expect(w).toHaveLength(13);
    expect(w[12]).toMatchObject({ key: "2026-W48", start: "2026-11-23", end: "2026-11-29", current: true });
    expect(w[0].key).toBe("2026-W36");
    expect(lastWeeks(new Date("2026-11-30T03:00:00Z"))[12].key).toBe("2026-W49"); // 00:00 de segunda em Brasília
    expect(lastWeeks(new Date("2026-11-30T02:59:59Z"))[12].key).toBe("2026-W48");
  });

  it("limites em instantes de Brasília", () => {
    const w = lastWeeks(new Date("2026-11-27T12:00:00Z"))[12];
    expect(w.startAt.toISOString()).toBe("2026-11-23T03:00:00.000Z");
    expect(w.endAt.toISOString()).toBe("2026-11-30T02:59:59.999Z");
  });

  it("atravessa o ano sem repetir chave", () => {
    const keys = lastWeeks(new Date("2027-01-12T12:00:00Z")).map((w) => w.key);
    expect(new Set(keys).size).toBe(13);
    expect(keys.slice(-3)).toEqual(["2026-W53", "2027-W01", "2027-W02"]);
  });
});

describe("comparação com a meta", () => {
  it("bordas: abaixo de 90% abaixo; 90% e 110% na meta; acima de 110% acima", () => {
    expect(compare(89.9, 100)).toBe("abaixo");
    expect(compare(90, 100)).toBe("na_meta");
    expect(compare(110, 100)).toBe("na_meta");
    expect(compare(110.1, 100)).toBe("acima");
    expect(compare(5, null)).toBe("sem_meta");
    expect(compare(5, 0)).toBe("sem_meta");
    expect(compare(null, 10)).toBe("sem_dados");
  });
});

describe("rotas do placar", () => {
  it("monta 10 números e 13 semanas com retratos e dados do blog", async () => {
    const week = lastWeeks()[12];
    await MetricSnapshot.create([
      { source: "prospect0101", key: "contatos_semana", period: week.key, value: 30 },
      { source: "prospect0101", key: "receita_mes", period: week.month, value: 4000 },
    ]);
    await createPost({ title: "Publicado", published: true, publishedAt: new Date() });
    await models.Subscriber.create({ email: "novo@teste.dev", status: "active" });
    const admin = await asAdmin();
    expect((await admin.put("/api/cockpit/placar/metas").send({ metas: { contatos_semana: 20, posts_publicados: 1 } })).status).toBe(200);
    const body = (await admin.get("/api/cockpit/placar")).body;
    expect(body.numeros).toHaveLength(10);
    expect(body.weeks).toHaveLength(13);
    const by = Object.fromEntries(body.numeros.map((n) => [n.key, n]));
    expect(by.contatos_semana.current).toMatchObject({ value: 30, status: "acima" });
    expect(by.contatos_semana.meta).toBe(20);
    expect(by.receita_mes.current.value).toBe(4000);
    expect(by.receita_mes.current.status).toBe("sem_meta");
    expect(by.posts_publicados.current).toMatchObject({ value: 1, status: "na_meta" });
    expect(by.inscritos_novos.current.value).toBe(1);
    expect(by.respostas_semana.current.status).toBe("sem_dados");
  });

  it("metas: salva, apaga com null, recusa chave desconhecida, negativo e vazio", async () => {
    const admin = await asAdmin();
    await admin.put("/api/cockpit/placar/metas").send({ metas: { contatos_semana: 20 } });
    await admin.put("/api/cockpit/placar/metas").send({ metas: { respostas_semana: 5 } });
    const res = await admin.put("/api/cockpit/placar/metas").send({ metas: { contatos_semana: null } });
    expect(res.body.metas).toEqual({ respostas_semana: 5 });
    expect((await admin.put("/api/cockpit/placar/metas").send({ metas: { hack: 1 } })).status).toBe(422);
    expect((await admin.put("/api/cockpit/placar/metas").send({ metas: { contatos_semana: -1 } })).status).toBe(422);
    expect((await admin.put("/api/cockpit/placar/metas").send({ metas: {} })).status).toBe(422);
  });
});

const sample = (value = 3) => ({
  numeros: [
    { key: "contatos_semana", meta: 10, current: { value, status: "abaixo" } },
    { key: "respostas_semana", meta: null, current: { value: null, status: "sem_dados" } },
  ],
});

describe("resumo da manhã no Telegram", () => {
  const env = { TELEGRAM_BOT_TOKEN: "t0ken", TELEGRAM_CHAT_ID: "42" };

  it("texto curto com números e status em texto", () => {
    const t = buildMorningText({ placar: sample(), pendencias: 2 });
    expect(t).toContain("Contatos: 3 de 10 (abaixo da meta)");
    expect(t).not.toContain("Respostas");
    expect(t).toContain("Pendências no painel: 2.");
  });

  it("não vaza e-mail nem telefone injetados em rótulo, nota, chave, status ou erro de rotina", () => {
    const placar = sample();
    placar.numeros[0].label = "joao@cliente.com";
    placar.numeros[0].note = "(11) 99999-8888";
    placar.numeros.push({ key: "joao@cliente.com", meta: 1, current: { value: 5, status: "joao@cliente.com" } });
    const t = buildMorningText({ placar, pendencias: 0, jobs: [{ lastError: "falhou para 11999998888 joao@cliente.com" }] });
    expect(t).not.toMatch(/@|joao|99999|11999998888/);
  });

  it("sem configuração: não envia e responde 'não configurado'", async () => {
    const fetchImpl = vi.fn();
    expect(await sendMorningSummary("oi", { env: {}, fetchImpl })).toBe("não configurado");
    expect(await sendMorningSummary("oi", { env: { TELEGRAM_BOT_TOKEN: "x" }, fetchImpl })).toBe("não configurado");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("com configuração: envia só ao chat configurado", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    expect(await sendMorningSummary("Contatos: 3", { env, fetchImpl })).toBe("enviado");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bott0ken/sendMessage");
    expect(JSON.parse(init.body).chat_id).toBe("42");
  });

  it("barreira final: texto com cara de dado de pessoa não sai; erro de rede não lança", async () => {
    const fetchImpl = vi.fn();
    expect(await sendMorningSummary("fale com a@b.com", { env, fetchImpl })).toBe("bloqueado");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await sendMorningSummary("ok", { env, fetchImpl: vi.fn().mockRejectedValue(new Error("rede")) })).toBe("falhou");
  });

  it("recusa chat_id diferente do configurado", () => {
    expect(chatAllowed(42, env)).toBe(true);
    expect(chatAllowed("42", env)).toBe(true);
    expect(chatAllowed(43, env)).toBe(false);
    expect(chatAllowed(42, {})).toBe(false);
    expect(telegramConfig({})).toBeNull();
  });

  it("cron diário sem variáveis: segue normal e registra 'não configurado'", async () => {
    const res = await api().get("/api/cron/daily").set("Authorization", "Bearer cron-de-teste");
    expect(res.status).toBe(200);
    expect(res.body.telegram).toBe("não configurado");
  });
});
