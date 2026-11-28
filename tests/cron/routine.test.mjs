import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, asAdmin, createPost, models, transporter } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const { runDailyJobs } = require("../../app/services/scheduler.service");
const { BlogPost, Campaign, Subscriber } = models;

// TEST-05: rotina diária (SISTEMA.md, seção 11). Os alertas (R-ALERT) e o básico
// da publicação estão em daily.test.mjs. Aqui: publicar vencidos, restaurar da
// lixeira e retomar envios. Regras de email (R-EMAIL) ficam na TEST-03.

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

describe("publica os agendados vencidos", () => {
  it("marca como publicado, com status, flag legado e data de publicação", async () => {
    const post = await createPost({ title: "Vencido de ontem", status: "planned", plannedAt: ago(DAY) });
    const now = new Date();

    const summary = await runDailyJobs(now);

    expect(summary.published).toEqual(["Vencido de ontem"]);
    const saved = await BlogPost.findById(post._id).lean();
    expect(saved).toMatchObject({ status: "published", published: true });
    expect(saved.publishedAt).toEqual(now);
    expect(saved.deletedAt).toBeNull();
  });

  it("publica os mais antigos primeiro", async () => {
    await createPost({ title: "Terceiro", status: "planned", plannedAt: ago(1 * DAY) });
    await createPost({ title: "Primeiro", status: "planned", plannedAt: ago(3 * DAY) });
    await createPost({ title: "Segundo", status: "planned", plannedAt: ago(2 * DAY) });

    const summary = await runDailyJobs();
    expect(summary.published).toEqual(["Primeiro", "Segundo", "Terceiro"]);
  });

  it("data de hoje que já chegou publica; data exata do instante da rotina também (<= agora)", async () => {
    const now = new Date("2026-12-01T12:00:00.000Z");
    await createPost({ title: "Na hora exata", status: "planned", plannedAt: now });
    await createPost({ title: "Um segundo depois", status: "planned", plannedAt: new Date(now.getTime() + 1000) });

    const summary = await runDailyJobs(now);
    expect(summary.published).toEqual(["Na hora exata"]);
  });

  it("rascunho e já publicado com data vencida não são mexidos", async () => {
    const draft = await createPost({ title: "Rascunho com data", status: "draft", plannedAt: ago(DAY) });
    const publishedAt = ago(5 * DAY);
    const live = await createPost({ title: "Já no ar", status: "published", published: true, publishedAt, plannedAt: ago(DAY) });

    const summary = await runDailyJobs();

    expect(summary.published).toEqual([]);
    expect((await BlogPost.findById(draft._id).lean()).status).toBe("draft");
    expect((await BlogPost.findById(live._id).lean()).publishedAt).toEqual(publishedAt);
  });

  it("rodar de novo não publica nem avisa de novo (idempotente)", async () => {
    await createPost({ title: "Só uma vez", status: "planned", plannedAt: ago(DAY) });
    expect((await runDailyJobs()).published).toEqual(["Só uma vez"]);
    expect((await runDailyJobs()).published).toEqual([]);
  });

  it("falha no aviso por email não desfaz a publicação nem impede os outros posts", async () => {
    transporter.sendMail.mockRejectedValue(new Error("SMTP fora do ar"));
    await createPost({ title: "Primeiro da fila", status: "planned", plannedAt: ago(2 * DAY) });
    await createPost({ title: "Segundo da fila", status: "planned", plannedAt: ago(1 * DAY) });

    const summary = await runDailyJobs();

    expect(summary.published).toEqual(["Primeiro da fila", "Segundo da fila"]);
    expect(await BlogPost.countDocuments({ status: "published" })).toBe(2);
  });

  it("post com LinkedIn ligado que falha: publicado, e o erro vai no resumo", async () => {
    // LinkedIn não configurado nos testes: o envio falha ou é ignorado, nunca derruba a rotina
    const post = await createPost({ title: "Com LinkedIn", status: "planned", plannedAt: ago(DAY), linkedin: { enabled: true } });
    const summary = await runDailyJobs();
    expect(summary.published).toEqual(["Com LinkedIn"]);
    expect((await BlogPost.findById(post._id).lean()).status).toBe("published");
    expect(summary.linkedin).not.toContain("Com LinkedIn");
  });

  it("pela rota do cron: publica e devolve o resumo", async () => {
    await createPost({ title: "Pela rota", status: "planned", plannedAt: ago(DAY) });
    const res = await api().get("/api/cron/daily").set("Authorization", "Bearer cron-de-teste");
    expect(res.status).toBe(200);
    expect(res.body.published).toEqual(["Pela rota"]);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it("sem CRON_SECRET configurado a rota fica fechada (503); segredo errado: 401", async () => {
    expect((await api().get("/api/cron/daily").set("Authorization", "Bearer errado")).status).toBe(401);
    const secret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "";
    try {
      expect((await api().get("/api/cron/daily").set("Authorization", "Bearer ")).status).toBe(503);
    } finally {
      process.env.CRON_SECRET = secret;
    }
  });
});

describe("agendado vencido que passou pela lixeira (R-TRASH-02 + rotina)", () => {
  it("restaurar agendado vencido vira rascunho e a rotina NÃO o publica", async () => {
    const admin = await asAdmin();
    const post = await createPost({ title: "Esquecido na lixeira", status: "planned", plannedAt: ago(DAY), deletedAt: new Date() });

    // Na lixeira a rotina também não publica
    expect((await runDailyJobs()).published).toEqual([]);

    await admin.patch(`/api/posts/${post._id}/restore`);
    expect((await BlogPost.findById(post._id).lean()).status).toBe("draft");

    const summary = await runDailyJobs();
    expect(summary.published).toEqual([]);
    const saved = await BlogPost.findById(post._id).lean();
    expect(saved.status).toBe("draft");
    expect(saved.published).toBe(false);
  });

  it("restaurar agendado com data futura mantém na fila; a rotina só o publica quando a data chega", async () => {
    const admin = await asAdmin();
    const plannedAt = new Date(Date.now() + 2 * DAY);
    const post = await createPost({ title: "Futuro na lixeira", status: "planned", plannedAt, deletedAt: new Date() });

    await admin.patch(`/api/posts/${post._id}/restore`);
    expect((await runDailyJobs()).published).toEqual([]);
    expect((await BlogPost.findById(post._id).lean()).status).toBe("planned");

    // Dois dias e um minuto depois, a rotina publica
    const later = new Date(plannedAt.getTime() + 60 * 1000);
    expect((await runDailyJobs(later)).published).toEqual(["Futuro na lixeira"]);
  });
});

describe("retoma envios parados (seção 11, item 2)", () => {
  const env = {};
  beforeEach(() => {
    for (const k of ["GMAIL_USER", "GMAIL_APP_PASSWORD", "ADMIN_EMAIL"]) env[k] = process.env[k];
    // ADMIN_EMAIL vazio e sem pendência: o único email possível é o do envio
    Object.assign(process.env, { GMAIL_USER: "blog@teste.dev", GMAIL_APP_PASSWORD: "x", ADMIN_EMAIL: "" });
  });
  afterEach(() => Object.assign(process.env, env));

  const stuckCampaign = async (subject = "Envio parado") => {
    const sub = await Subscriber.create({ email: "leitor@x.dev" });
    return Campaign.create({
      subject,
      body: "<p>Olá</p>",
      status: "sending",
      startedAt: ago(DAY),
      recipients: [{ subscriber: sub._id, email: sub.email }],
    });
  };

  it("chama o envio dos 'enviando', manda os pendentes e conclui; aparece em `resumed`", async () => {
    const campaign = await stuckCampaign();

    const summary = await runDailyJobs();

    expect(summary.resumed).toEqual(["Envio parado"]);
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail.mock.calls[0][0].to).toContain("leitor@x.dev");
    const saved = await Campaign.findById(campaign._id).lean();
    expect(saved.status).toBe("sent");
    expect(saved.recipients[0].status).toBe("sent");
  });

  it("não reenvia para quem já recebeu", async () => {
    const sub = await Subscriber.create({ email: "ja@x.dev" });
    const sub2 = await Subscriber.create({ email: "falta@x.dev" });
    await Campaign.create({
      subject: "Meio enviado",
      body: "<p>Olá</p>",
      status: "sending",
      recipients: [
        { subscriber: sub._id, email: sub.email, status: "sent", sentAt: ago(DAY) },
        { subscriber: sub2._id, email: sub2.email },
      ],
    });

    await runDailyJobs();

    const to = transporter.sendMail.mock.calls.map((c) => c[0].to).join(",");
    expect(to).toContain("falta@x.dev");
    expect(to).not.toContain("ja@x.dev");
  });

  it("só retoma 'enviando': rascunho e já enviado ficam como estão", async () => {
    await Campaign.create({ subject: "Rascunho", body: "<p>x</p>", status: "draft" });
    await Campaign.create({ subject: "Concluído", body: "<p>x</p>", status: "sent", sentAt: ago(10 * DAY) });

    const summary = await runDailyJobs();

    expect(summary.resumed).toEqual([]);
    expect(transporter.sendMail).not.toHaveBeenCalled();
    expect((await Campaign.findOne({ subject: "Rascunho" }).lean()).status).toBe("draft");
  });

  it("retoma vários envios parados", async () => {
    await stuckCampaign("Primeiro parado");
    await Campaign.create({ subject: "Segundo parado", body: "<p>x</p>", status: "sending" });

    const summary = await runDailyJobs();

    expect([...summary.resumed].sort()).toEqual(["Primeiro parado", "Segundo parado"]);
    expect((await Campaign.countDocuments({ status: "sending" }))).toBe(0);
  });

  it("sem email configurado: não retoma nada (o envio continua 'enviando' e vira alerta)", async () => {
    Object.assign(process.env, { GMAIL_USER: "", GMAIL_APP_PASSWORD: "" });
    const campaign = await stuckCampaign();

    const summary = await runDailyJobs();

    expect(summary.resumed).toEqual([]);
    expect(transporter.sendMail).not.toHaveBeenCalled();
    expect((await Campaign.findById(campaign._id).lean()).status).toBe("sending");
  });

  it("pela rota do cron também retoma", async () => {
    await stuckCampaign("Pela rota");
    const res = await api().get("/api/cron/daily").set("Authorization", "Bearer cron-de-teste");
    expect(res.body.resumed).toEqual(["Pela rota"]);
  });
});
