import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, createPost, models, transporter } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const { runDailyJobs } = require("../../app/services/scheduler.service");
const { collectAlerts } = require("../../app/services/alerts.service");
const LinkedInAccount = require("../../app/models/linkedinAccount.model");
const { BlogPost, Campaign, Subscriber } = models;

const DAY = 24 * 60 * 60 * 1000;
const titles = (alerts) => alerts.map((a) => a.title);

describe("rota do cron", () => {
  it("sem o segredo: 401", async () => {
    expect((await api().get("/api/cron/daily")).status).toBe(401);
  });

  it("com o segredo da Vercel: roda e devolve o resumo", async () => {
    const res = await api().get("/api/cron/daily").set("Authorization", "Bearer cron-de-teste");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("published");
  });
});

describe("rotina diária: publicação (seção 11)", () => {
  it("publica agendado vencido e não mexe no futuro nem no da lixeira", async () => {
    const due = await createPost({ title: "Vencido", status: "planned", plannedAt: new Date(Date.now() - 1000) });
    const future = await createPost({ title: "Futuro", status: "planned", plannedAt: new Date(Date.now() + DAY) });
    const trashed = await createPost({ title: "Lixeira", status: "planned", plannedAt: new Date(Date.now() - DAY), deletedAt: new Date() });

    const summary = await runDailyJobs();

    expect(summary.published).toEqual(["Vencido"]);
    expect((await BlogPost.findById(due._id).lean()).published).toBe(true);
    expect((await BlogPost.findById(future._id).lean()).status).toBe("planned");
    expect((await BlogPost.findById(trashed._id).lean()).status).toBe("planned");
  });
});

describe("alertas (SEC-07)", () => {
  const env = {};
  beforeEach(() => {
    for (const k of ["GMAIL_USER", "GMAIL_APP_PASSWORD", "ADMIN_EMAIL"]) env[k] = process.env[k];
  });
  afterEach(() => Object.assign(process.env, env));

  it("sem pendências: nenhum alerta e nenhum email", async () => {
    Object.assign(process.env, { GMAIL_USER: "blog@teste.dev", GMAIL_APP_PASSWORD: "x", ADMIN_EMAIL: "eu@teste.dev" });
    const summary = await runDailyJobs();
    expect(summary.alerts).toBe(0);
    expect(summary.alertEmail).toBe(false);
    expect(transporter.sendMail).not.toHaveBeenCalled();
  });

  it("envio das últimas 24h com falha", async () => {
    await Campaign.create({
      subject: "Novidades",
      status: "sent",
      sentAt: new Date(),
      recipients: [
        { email: "a@x.dev", status: "sent" },
        { email: "b@x.dev", status: "failed" },
      ],
    });
    const alerts = await collectAlerts();
    expect(titles(alerts)).toContain("Envio com falhas");
    expect(alerts[0].detail).toContain("1 de 2");
  });

  it("envio com falha antigo (mais de 24h) não repete todo dia", async () => {
    await Campaign.create({ subject: "Velho", status: "sent", sentAt: new Date(Date.now() - 3 * DAY), recipients: [{ email: "b@x.dev", status: "failed" }] });
    expect(titles(await collectAlerts())).not.toContain("Envio com falhas");
  });

  it("aviso de post publicado que ficou em rascunho (R-EMAIL-03)", async () => {
    const post = await createPost({ status: "published", published: true });
    await Campaign.create({ subject: "Novo artigo: x", kind: "post-notification", post: post._id, status: "draft" });
    expect(titles(await collectAlerts())).toContain("Aviso de post não enviado");
  });

  it("aviso em rascunho de post ainda não publicado não é pendência", async () => {
    const post = await createPost({ status: "draft" });
    await Campaign.create({ subject: "Novo artigo: x", kind: "post-notification", post: post._id, status: "draft" });
    expect(titles(await collectAlerts())).not.toContain("Aviso de post não enviado");
  });

  it("agendado vencido que não publicou e envio parado", async () => {
    await createPost({ status: "planned", plannedAt: new Date(Date.now() - DAY) });
    await Campaign.create({ subject: "Lote", status: "sending" });
    const t = titles(await collectAlerts());
    expect(t).toContain("Agendado não foi ao ar");
    expect(t).toContain("Envio parado");
  });

  it("LinkedIn: post que falhou e conexão perto de expirar", async () => {
    await createPost({ status: "published", published: true, linkedin: { enabled: true, status: "failed", error: "LinkedIn 401" } });
    await LinkedInAccount.create({ personUrn: "urn:li:person:1", accessToken: "t", expiresAt: new Date(Date.now() + 3 * DAY) });
    const alerts = await collectAlerts();
    expect(titles(alerts)).toContain("LinkedIn falhou");
    expect(titles(alerts)).toContain("LinkedIn expira em breve");
  });

  it("LinkedIn desconectado só alerta se há post esperando", async () => {
    expect(titles(await collectAlerts())).not.toContain("LinkedIn desconectado");
    await createPost({ status: "planned", plannedAt: new Date(Date.now() + DAY), linkedin: { enabled: true } });
    expect(titles(await collectAlerts())).toContain("LinkedIn desconectado");
  });

  it("com pendência: um email para o admin, com o texto escapado", async () => {
    Object.assign(process.env, { GMAIL_USER: "blog@teste.dev", GMAIL_APP_PASSWORD: "x", ADMIN_EMAIL: "eu@teste.dev" });
    // Pendência que a rotina não resolve sozinha (envio parado ela retoma e conclui)
    await createPost({
      title: "<img src=x onerror=alert(1)>",
      status: "published",
      published: true,
      linkedin: { enabled: true, status: "failed", error: "LinkedIn 500" },
    });

    const summary = await runDailyJobs();

    expect(summary.alertEmail).toBe(true);
    const alertMails = transporter.sendMail.mock.calls.map((c) => c[0]).filter((m) => m.to === "eu@teste.dev");
    expect(alertMails).toHaveLength(1);
    expect(alertMails[0].subject).toMatch(/^\[Blog\] \d+ pendência/);
    expect(alertMails[0].html).not.toContain("<img src=x");
  });

  it("sem email configurado: a rotina segue, só não manda", async () => {
    Object.assign(process.env, { GMAIL_USER: "", GMAIL_APP_PASSWORD: "" });
    await Campaign.create({ subject: "Lote", status: "sending" });
    const summary = await runDailyJobs();
    expect(summary.alerts).toBeGreaterThan(0);
    expect(summary.alertEmail).toBe(false);
  });

  it("assinante não recebe o alerta", async () => {
    Object.assign(process.env, { GMAIL_USER: "blog@teste.dev", GMAIL_APP_PASSWORD: "x", ADMIN_EMAIL: "eu@teste.dev" });
    await Subscriber.create({ email: "leitor@x.dev" });
    await createPost({ status: "published", published: true, linkedin: { enabled: true, status: "failed" } });
    await runDailyJobs();
    expect(transporter.sendMail).toHaveBeenCalled();
    const to = transporter.sendMail.mock.calls.map((c) => c[0].to);
    expect(to).not.toContain("leitor@x.dev");
  });
});

describe("Dashboard: avisos de post não enviados (BIZ-03)", () => {
  it("lista só os de posts publicados, com o título do post", async () => {
    const { asAdmin } = await import("../helpers.mjs");
    const admin = await asAdmin();
    const live = await createPost({ title: "Publicado", status: "published", published: true });
    const draft = await createPost({ title: "Rascunho" });
    const notice = await Campaign.create({ subject: "Novo artigo: Publicado", kind: "post-notification", post: live._id, status: "draft" });
    await Campaign.create({ subject: "Novo artigo: Rascunho", kind: "post-notification", post: draft._id, status: "draft" });
    await Campaign.create({ subject: "Já enviado", kind: "post-notification", post: live._id, status: "sent" });

    const res = await admin.get("/api/dashboard/stats");
    expect(res.body.unsentNotices).toEqual([{ _id: String(notice._id), postTitle: "Publicado" }]);
  });
});
