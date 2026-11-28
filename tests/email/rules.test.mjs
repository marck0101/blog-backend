import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, asAdmin, createPost, models, transporter } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const service = require("../../app/services/campaign.service");
const tracking = require("../../app/services/tracking.service");
const { runDailyJobs } = require("../../app/services/scheduler.service");
const { SITE_URL } = require("../../app/config/urls");
const { BlogPost, Campaign, Subscriber } = models;

// TEST-03: regras de email (SISTEMA.md, seção 5.2, R-EMAIL-01 a 13).
// Tudo com o transporter simulado (tests/setup/env.mjs): nenhum email sai de verdade.

const mails = () => transporter.sendMail.mock.calls.map((c) => c[0]);
const mailTo = (email) => mails().find((m) => m.to === email);
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const params = (url) => Object.fromEntries(new URL(url).searchParams);
const blogLink = (path = "/blog/qualquer") => `${SITE_URL}${path}`;
const events = () => Campaign.db.collection("emailevents");

const subscribers = (n, overrides = {}) =>
  Promise.all(Array.from({ length: n }, (_, i) => Subscriber.create({ email: `leitor${i}@x.dev`, ...overrides })));

// Relógio controlável: cada email enviado "gasta" ms, para estourar o orçamento de 7 s
function slowMailer(costMs) {
  const real = Date.now.bind(Date);
  let offset = 0;
  vi.spyOn(Date, "now").mockImplementation(() => real() + offset);
  transporter.sendMail.mockImplementation(async () => {
    offset += costMs;
    return { messageId: "teste" };
  });
}

let env;
beforeEach(() => {
  env = { GMAIL_USER: process.env.GMAIL_USER, GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD };
  Object.assign(process.env, { GMAIL_USER: "blog@teste.dev", GMAIL_APP_PASSWORD: "x" });
});
afterEach(() => Object.assign(process.env, env));

describe("aviso de post novo (R-EMAIL-01 a 03)", () => {
  it("R-EMAIL-01 um aviso por post: chamar de novo não cria nem envia outro", async () => {
    await subscribers(1, { categories: ["tecnologia"] });
    const post = await createPost({ status: "published", published: true });

    const first = await service.notifyNewPost(post);
    const second = await service.notifyNewPost(post);

    expect(String(second._id)).toBe(String(first._id));
    expect(await Campaign.countDocuments({ kind: "post-notification", post: post._id })).toBe(1);
    expect(mails()).toHaveLength(1);
  });

  it("R-EMAIL-01 vale também para aviso que ficou em rascunho: não cria outro", async () => {
    const post = await createPost({ status: "published", published: true });
    await service.notifyNewPost(post); // sem assinantes: rascunho
    await subscribers(1, { categories: ["tecnologia"] });
    await service.notifyNewPost(post);

    const notices = await Campaign.find({ kind: "post-notification", post: post._id }).lean();
    expect(notices).toHaveLength(1);
    expect(notices[0].status).toBe("draft");
    expect(mails()).toHaveLength(0);
  });

  it("R-EMAIL-01 aviso desligado no post (emailNotify false): nada é criado", async () => {
    const post = await createPost({ status: "published", published: true, emailNotify: false });
    expect(await service.notifyNewPost(post)).toBeNull();
    expect(await Campaign.countDocuments()).toBe(0);
  });

  it("R-EMAIL-02 público 'categoria do post' usa a categoria atual na hora da publicação", async () => {
    await Subscriber.create({ email: "tec@x.dev", categories: ["tecnologia"] });
    await Subscriber.create({ email: "des@x.dev", categories: ["design"] });
    const post = await createPost({ category: "tecnologia" });
    // categoria mudou antes de publicar
    await BlogPost.updateOne({ _id: post._id }, { category: "design", status: "published", published: true });

    const notice = await service.notifyNewPost(await BlogPost.findById(post._id));

    expect(notice.audience.type).toBe("categories");
    expect(notice.audience.categories).toEqual(["design"]);
    expect(notice.recipients.map((r) => r.email)).toEqual(["des@x.dev"]);
    expect(mailTo("tec@x.dev")).toBeUndefined();
  });

  it("R-EMAIL-02 só assinantes ativos entram no público", async () => {
    await Subscriber.create({ email: "ativo@x.dev", categories: ["tecnologia"] });
    await Subscriber.create({ email: "saiu@x.dev", categories: ["tecnologia"], status: "unsubscribed" });
    const post = await createPost({ status: "published", published: true });
    const notice = await service.notifyNewPost(post);
    expect(notice.recipients.map((r) => r.email)).toEqual(["ativo@x.dev"]);
  });

  it("R-EMAIL-03 público com 0 pessoas: vira rascunho e não envia", async () => {
    await Subscriber.create({ email: "outra@x.dev", categories: ["design"] });
    const post = await createPost({ status: "published", published: true });

    const notice = await service.notifyNewPost(post);

    expect(notice.status).toBe("draft");
    expect(notice.recipients).toHaveLength(0);
    expect(mails()).toHaveLength(0);
  });

  it("R-EMAIL-03 Gmail sem configuração: vira rascunho e não envia", async () => {
    Object.assign(process.env, { GMAIL_USER: "", GMAIL_APP_PASSWORD: "" });
    await subscribers(2, { categories: ["tecnologia"] });
    const post = await createPost({ status: "published", published: true });

    const notice = await service.notifyNewPost(post);

    expect(notice.status).toBe("draft");
    expect(mails()).toHaveLength(0);
  });

  it("R-EMAIL-03 rascunho de aviso não sai sozinho: a rotina diária não envia rascunho", async () => {
    await subscribers(1, { categories: ["tecnologia"] });
    const post = await createPost({ status: "published", published: true });
    await Campaign.create({
      subject: "Aviso",
      kind: "post-notification",
      post: post._id,
      status: "draft",
      audience: { type: "categories", categories: ["tecnologia"] },
    });

    await runDailyJobs();

    expect(mails().filter((m) => m.to === "leitor0@x.dev")).toHaveLength(0);
    expect((await Campaign.findOne({ post: post._id })).status).toBe("draft");
  });

  it("R-EMAIL-03 unsentPostNotices lista só rascunhos de avisos de posts publicados", async () => {
    const live = await createPost({ title: "No ar", status: "published", published: true });
    const hidden = await createPost({ title: "Escondido" });
    const trashed = await createPost({ title: "Lixeira", status: "published", published: true, deletedAt: new Date() });
    const mk = (post) => Campaign.create({ subject: `Aviso ${post.title}`, kind: "post-notification", post: post._id, status: "draft" });
    await mk(live);
    await mk(hidden);
    await mk(trashed);
    await Campaign.create({ subject: "Já enviado", kind: "post-notification", post: live._id, status: "sent" });
    await Campaign.create({ subject: "Avulso", status: "draft" });

    const list = await service.unsentPostNotices();

    expect(list).toHaveLength(1);
    expect(list[0].subject).toBe("Aviso No ar");
    expect(list[0].post.title).toBe("No ar");
  });
});

describe("destinatários, lotes e retomada (R-EMAIL-04, 05)", () => {
  it("R-EMAIL-04 lista congelada no primeiro envio: quem assina depois não entra", async () => {
    const campaign = await Campaign.create({ subject: "Oi", content: "<p>a</p>", audience: { type: "all" } });
    await subscribers(7);
    slowMailer(8000); // 1º lote estoura o orçamento: fica "enviando"

    await service.processCampaign(campaign);
    const frozen = (await Campaign.findById(campaign._id)).recipients.map((r) => r.email);
    expect(frozen).toHaveLength(7);

    await Subscriber.create({ email: "tardio@x.dev" });
    await service.processCampaign(await Campaign.findById(campaign._id));
    await service.processCampaign(await Campaign.findById(campaign._id));

    const final = await Campaign.findById(campaign._id).lean();
    expect(final.recipients.map((r) => r.email)).toEqual(frozen);
    expect(final.status).toBe("sent");
    expect(mailTo("tardio@x.dev")).toBeUndefined();
  });

  it("R-EMAIL-04 quem cancela no meio do envio vira falha e não recebe", async () => {
    await subscribers(7);
    const campaign = await Campaign.create({ subject: "Oi", content: "<p>a</p>", audience: { type: "all" } });
    slowMailer(8000);
    await service.processCampaign(campaign);

    // cancela alguém que ainda estava pendente
    const cancelled = (await Campaign.findById(campaign._id)).recipients.find((r) => r.status === "pending");
    await Subscriber.updateOne({ _id: cancelled.subscriber }, { status: "unsubscribed" });
    await service.processCampaign(await Campaign.findById(campaign._id));
    await service.processCampaign(await Campaign.findById(campaign._id));

    const final = await Campaign.findById(campaign._id).lean();
    const r = final.recipients.find((x) => x.email === cancelled.email);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/cancelada/);
    expect(mailTo(cancelled.email)).toBeUndefined();
    expect(final.status).toBe("sent");
    expect(mails()).toHaveLength(6);
  });

  it("R-EMAIL-05 envia em lotes de 5 em paralelo", async () => {
    await subscribers(12);
    let inFlight = 0;
    let peak = 0;
    transporter.sendMail.mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return {};
    });
    const campaign = await Campaign.create({ subject: "Oi", content: "<p>a</p>", audience: { type: "all" } });

    await service.processCampaign(campaign);

    expect(peak).toBe(5);
    expect(mails()).toHaveLength(12);
    expect((await Campaign.findById(campaign._id)).status).toBe("sent");
  });

  it("R-EMAIL-05 estourou o orçamento de 7 s: fica 'enviando' e cada chamada continua de onde parou", async () => {
    await subscribers(12);
    slowMailer(8000);
    const campaign = await Campaign.create({ subject: "Oi", content: "<p>a</p>", audience: { type: "all" } });
    const stats = async () => (await Campaign.findById(campaign._id)).stats();

    await service.processCampaign(campaign);
    let saved = await Campaign.findById(campaign._id);
    expect(saved.status).toBe("sending");
    expect(saved.sentAt).toBeUndefined();
    expect(await stats()).toMatchObject({ sent: 5, pending: 7 });

    await service.processCampaign(saved);
    expect(await stats()).toMatchObject({ sent: 10, pending: 2 });

    await service.processCampaign(await Campaign.findById(campaign._id));
    saved = await Campaign.findById(campaign._id);
    expect(saved.status).toBe("sent");
    expect(saved.sentAt).toBeTruthy();
    // ninguém recebeu duas vezes
    expect(new Set(mails().map((m) => m.to)).size).toBe(12);
    expect(mails()).toHaveLength(12);
  });

  it("R-EMAIL-05 a rotina diária retoma os envios parados em 'enviando'", async () => {
    const [a, b] = await subscribers(2);
    const campaign = await Campaign.create({
      subject: "Parado",
      content: "<p>a</p>",
      status: "sending",
      tracking: true,
      startedAt: new Date(),
      recipients: [
        { subscriber: a._id, email: a.email, status: "sent", sentAt: new Date() },
        { subscriber: b._id, email: b.email, status: "pending" },
      ],
    });

    const summary = await runDailyJobs();

    expect(summary.resumed).toContain("Parado");
    expect((await Campaign.findById(campaign._id)).status).toBe("sent");
    expect(mails().filter((m) => m.subject === "Parado").map((m) => m.to)).toEqual([b.email]);
  });

  it("R-EMAIL-05 o painel chama /send de novo e continua o envio parado", async () => {
    const admin = await asAdmin();
    await subscribers(8);
    slowMailer(8000);
    const campaign = await Campaign.create({ subject: "Oi", content: "<p>a</p>", audience: { type: "all" } });

    const first = await admin.post(`/api/campaigns/${campaign._id}/send`);
    expect(first.body.status).toBe("sending");
    const second = await admin.post(`/api/campaigns/${campaign._id}/send`);
    expect(second.body.status).toBe("sent");
    expect(second.body.stats.sent).toBe(8);
  });
});

describe("envio iniciado, tentar de novo e duplicar (R-EMAIL-06 a 08)", () => {
  const started = (status) =>
    Campaign.create({
      subject: "Já saiu",
      content: "<p>a</p>",
      status,
      recipients: [{ email: "a@x.dev", status: "sent" }],
    });

  it("R-EMAIL-06 rascunho pode ser editado e excluído", async () => {
    const admin = await asAdmin();
    const draft = await Campaign.create({ subject: "Rascunho", content: "<p>a</p>" });
    expect((await admin.patch(`/api/campaigns/${draft._id}`).send({ subject: "Novo" })).status).toBe(200);
    expect((await admin.delete(`/api/campaigns/${draft._id}`)).status).toBe(200);
    expect(await Campaign.countDocuments()).toBe(0);
  });

  it.each(["sending", "sent"])("R-EMAIL-06 envio '%s' não pode ser editado nem excluído (409)", async (status) => {
    const admin = await asAdmin();
    const campaign = await started(status);

    const edit = await admin.patch(`/api/campaigns/${campaign._id}`).send({ subject: "Mudou" });
    const del = await admin.delete(`/api/campaigns/${campaign._id}`);

    expect(edit.status).toBe(409);
    expect(del.status).toBe(409);
    expect((await Campaign.findById(campaign._id).lean()).subject).toBe("Já saiu");
  });

  it("R-EMAIL-06 enviar de novo um envio concluído não reenvia", async () => {
    const admin = await asAdmin();
    const campaign = await started("sent");
    const res = await admin.post(`/api/campaigns/${campaign._id}/send`);
    expect(res.status).toBe(200);
    expect(mails()).toHaveLength(0);
  });

  it("R-EMAIL-07 tentar de novo volta só as falhas para pendente e o envio reenvia só elas", async () => {
    const admin = await asAdmin();
    const [ok, bad] = await subscribers(2);
    const campaign = await Campaign.create({
      subject: "Parcial",
      content: "<p>a</p>",
      status: "sent",
      tracking: true,
      sentAt: new Date(),
      recipients: [
        { subscriber: ok._id, email: ok.email, status: "sent", sentAt: new Date() },
        { subscriber: bad._id, email: bad.email, status: "failed", error: "boom" },
      ],
    });

    const retry = await admin.post(`/api/campaigns/${campaign._id}/retry-failed`);
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe("sending");
    const byEmail = Object.fromEntries(retry.body.recipients.map((r) => [r.email, r]));
    expect(byEmail[ok.email].status).toBe("sent");
    expect(byEmail[bad.email].status).toBe("pending");
    expect(byEmail[bad.email].error).toBeUndefined();

    const sent = await admin.post(`/api/campaigns/${campaign._id}/send`);
    expect(sent.body.status).toBe("sent");
    expect(mails().map((m) => m.to)).toEqual([bad.email]);
  });

  it("R-EMAIL-07 sem falhas: 422; rascunho: 409", async () => {
    const admin = await asAdmin();
    const clean = await started("sent");
    const draft = await Campaign.create({ subject: "Rascunho", content: "<p>a</p>" });
    expect((await admin.post(`/api/campaigns/${clean._id}/retry-failed`)).status).toBe(422);
    expect((await admin.post(`/api/campaigns/${draft._id}/retry-failed`)).status).toBe(409);
  });

  it("R-EMAIL-08 duplicar como 'cópia' mantém o mesmo público, em rascunho", async () => {
    const admin = await asAdmin();
    const original = await Campaign.create({
      subject: "Original",
      preheader: "pré",
      content: "<p>a</p>",
      status: "sent",
      audience: { type: "categories", categories: ["tecnologia"], excludeMembers: true },
      recipients: [{ email: "a@x.dev", status: "sent" }],
    });

    const res = await admin.post(`/api/campaigns/${original._id}/duplicate`).send({ mode: "copy" });

    expect(res.status).toBe(201);
    expect(res.body._id).not.toBe(String(original._id));
    expect(res.body.status).toBe("draft");
    expect(res.body.subject).toBe("Original");
    expect(res.body.audience).toMatchObject({ type: "categories", categories: ["tecnologia"], excludeMembers: true });
    expect(res.body.recipients ?? []).toHaveLength(0);
  });

  it("R-EMAIL-08 'novos membros': só membros ativos que ainda não receberam o original", async () => {
    const admin = await asAdmin();
    const got = await Subscriber.create({ email: "recebeu@x.dev", tier: "member" });
    const failed = await Subscriber.create({ email: "falhou@x.dev", tier: "member" });
    const fresh = await Subscriber.create({ email: "novo@x.dev", tier: "member" });
    await Subscriber.create({ email: "free@x.dev", tier: "free" });
    await Subscriber.create({ email: "saiu@x.dev", tier: "member", status: "unsubscribed" });
    const original = await Campaign.create({
      subject: "Exclusivo",
      content: "<p>a</p>",
      status: "sent",
      audience: { type: "members" },
      recipients: [
        { subscriber: got._id, email: got.email, status: "sent" },
        { subscriber: failed._id, email: failed.email, status: "failed" },
      ],
    });

    const res = await admin.post(`/api/campaigns/${original._id}/duplicate`).send({ mode: "new-members" });

    expect(res.status).toBe(201);
    expect(res.body.audience.type).toBe("selected");
    expect([...res.body.audience.subscribers].sort()).toEqual([String(failed._id), String(fresh._id)].sort());
  });

  it("R-EMAIL-08 'novos membros' sem ninguém novo: 422", async () => {
    const admin = await asAdmin();
    const got = await Subscriber.create({ email: "recebeu@x.dev", tier: "member" });
    const original = await Campaign.create({
      subject: "Exclusivo",
      status: "sent",
      audience: { type: "members" },
      recipients: [{ subscriber: got._id, email: got.email, status: "sent" }],
    });
    const res = await admin.post(`/api/campaigns/${original._id}/duplicate`).send({ mode: "new-members" });
    expect(res.status).toBe(422);
  });
});

describe("botão 'Ler no blog' (R-EMAIL-09)", () => {
  const BUTTON = "Continuar lendo no blog";
  const sendFor = async (post) => {
    const [sub] = await subscribers(1);
    const campaign = await Campaign.create({ subject: "Aviso", content: "<p>a</p>", post: post._id, audience: { type: "all" } });
    await service.processCampaign(campaign);
    return mailTo(sub.email);
  };

  it("R-EMAIL-09 post publicado: o email tem o botão para o post", async () => {
    const post = await createPost({ title: "No ar", status: "published", published: true });
    const mail = await sendFor(post);
    expect(mail.html).toContain(BUTTON);
    expect(hrefs(mail.html).some((h) => decodeURIComponent(h).includes(`/blog/${post.slug}`))).toBe(true);
  });

  it.each([
    ["em rascunho", { status: "draft", published: false }],
    ["na lixeira", { status: "published", published: true, deletedAt: new Date() }],
  ])("R-EMAIL-09 post %s: sem botão", async (_label, fields) => {
    const post = await createPost(fields);
    const mail = await sendFor(post);
    expect(mail.html).not.toContain(BUTTON);
  });

  it("R-EMAIL-09 envio sem post ligado: sem botão", async () => {
    const [sub] = await subscribers(1);
    const campaign = await Campaign.create({ subject: "Avulso", content: "<p>a</p>", audience: { type: "all" } });
    await service.processCampaign(campaign);
    expect(mailTo(sub.email).html).not.toContain(BUTTON);
  });
});

describe("UTMs nos links (R-EMAIL-10)", () => {
  // Teste não rastreia, então os links aparecem diretos (sem redirecionamento)
  const testHtml = async (campaign, postUrl) => {
    await service.sendTest(campaign, "eu@x.dev", postUrl);
    return mails()[0].html;
  };

  it("R-EMAIL-10 link do blog no texto ganha UTM; externo e com UTM ficam como estão", async () => {
    const own = blogLink("/blog/outro-post");
    const already = `${blogLink("/blog/x")}?utm_source=twitter`;
    const campaign = new Campaign({
      subject: "Promoção de Natal",
      content: `<a href="${own}">a</a><a href="https://outro.site/p?x=1">b</a><a href="${already}">c</a>`,
    });

    const links = hrefs(await testHtml(campaign));

    expect(params(links[0])).toEqual({
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "envio-promocao-de-natal",
      utm_content: "link_texto",
    });
    expect(links[1]).toBe("https://outro.site/p?x=1");
    expect(links[2]).toBe(already);
  });

  it("R-EMAIL-10 aviso de post usa 'aviso-post-<assunto>' e o botão usa utm_content botao_ler_no_blog", async () => {
    const campaign = new Campaign({ subject: "Novo artigo: Meu Post", kind: "post-notification", content: "<p>a</p>" });
    const links = hrefs(await testHtml(campaign, blogLink("/blog/meu-post")));
    const button = links.find((h) => h.startsWith(blogLink("/blog/meu-post")));

    expect(params(button)).toMatchObject({
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "aviso-post-novo-artigo-meu-post",
      utm_content: "botao_ler_no_blog",
    });
  });

  it("R-EMAIL-10 em envio real a URL final (dentro do link rastreado) mantém as UTMs", async () => {
    const [sub] = await subscribers(1);
    const campaign = await Campaign.create({
      subject: "Dica",
      content: `<a href="${blogLink("/blog/a")}">a</a>`,
      audience: { type: "all" },
    });
    await service.processCampaign(campaign);

    const link = hrefs(mailTo(sub.email).html).find((h) => h.includes("/api/t/c/"));
    const target = params(link).u;
    expect(params(target)).toMatchObject({ utm_source: "newsletter", utm_campaign: "envio-dica", utm_content: "link_texto" });
  });
});

describe("rastreio só em envios reais (R-EMAIL-11)", () => {
  const withCampaign = async () => {
    const [sub] = await subscribers(1);
    const campaign = await Campaign.create({
      subject: "Dica",
      content: `<a href="${blogLink("/blog/a")}">a</a><a href="https://outro.site/">b</a>`,
      audience: { type: "all" },
    });
    return { sub, campaign };
  };

  it("R-EMAIL-11 email de teste nunca é rastreado: sem pixel, sem links de clique", async () => {
    const campaign = new Campaign({ subject: "Dica", tracking: true, content: `<a href="${blogLink()}">a</a>` });
    await service.sendTest(campaign, "eu@x.dev", blogLink("/blog/a"));
    const mail = mails()[0];

    expect(mail.subject).toBe("[TESTE] Dica");
    expect(mail.html).not.toContain("/api/t/o/");
    expect(mail.html).not.toContain("/api/t/c/");
    expect(mail.headers["List-Unsubscribe"]).not.toContain("?c=");
  });

  it("R-EMAIL-11 teste pela rota também não rastreia nem inicia o envio", async () => {
    const admin = await asAdmin();
    const { campaign } = await withCampaign();
    const res = await admin.post(`/api/campaigns/${campaign._id}/test`).send({ email: "eu@x.dev" });
    expect(res.status).toBe(200);
    expect(mails()[0].html).not.toContain("/api/t/");
    const saved = await Campaign.findById(campaign._id);
    expect(saved.status).toBe("draft");
    expect(saved.recipients).toHaveLength(0);
    expect(saved.tracking).toBe(false);
  });

  it("R-EMAIL-11 envio real tem pixel de abertura e todos os links http(s) rastreados", async () => {
    const { sub, campaign } = await withCampaign();
    await service.processCampaign(campaign);
    const mail = mailTo(sub.email);

    expect(mail.html).toMatch(/\/api\/t\/o\/[a-f0-9]{24}\/[a-f0-9]{24}\/[\w-]+\.gif/);
    const tracked = hrefs(mail.html).filter((h) => h.includes("/api/t/c/"));
    expect(tracked).toHaveLength(2);
    expect((await Campaign.findById(campaign._id)).tracking).toBe(true);
  });

  describe("abertura e clique (seção 5.3)", () => {
    const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36";

    const setup = async (sentAt = new Date(Date.now() - 60_000)) => {
      const [sub] = await subscribers(1);
      const campaign = await Campaign.create({
        subject: "Dica",
        status: "sent",
        tracking: true,
        recipients: [{ subscriber: sub._id, email: sub.email, status: "sent", sentAt }],
      });
      return { campaign, c: String(campaign._id), s: String(sub._id) };
    };
    const recipientOf = async (campaign) => (await Campaign.findById(campaign._id).lean()).recipients[0];
    const pixel = ({ c, s }, ua) => api().get(`/api/t/o/${c}/${s}/${tracking.sign(c, s)}.gif`).set("User-Agent", ua);
    const click = ({ c, s }, url, ua, sig = tracking.sign(c, s, url)) =>
      api().get(`/api/t/c/${c}/${s}/${sig}`).query({ u: url }).set("User-Agent", ua);

    it("R-EMAIL-11 abertura por pessoa é contada", async () => {
      const ctx = await setup();
      const res = await pixel(ctx, BROWSER);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/image\/gif/);
      const r = await recipientOf(ctx.campaign);
      expect(r.opens).toBe(1);
      expect(r.openedAt).toBeTruthy();
    });

    it.each(["Googlebot/2.1", "curl/8.0", "Mozilla/5.0 ProofpointScanner", "Microsoft SafeLinks"])(
      "R-EMAIL-11 abertura por robô (%s) vira evento automatizado e não conta",
      async (ua) => {
        const ctx = await setup();
        await pixel(ctx, ua);
        const r = await recipientOf(ctx.campaign);
        expect(r.opens).toBe(0);
        expect(r.openedAt).toBeUndefined();
        const saved = await events().find({}).toArray();
        expect(saved).toHaveLength(1);
        expect(saved[0].automated).toBe(true);
      }
    );

    it("R-EMAIL-11 assinatura inválida no pixel: imagem normal, nada registrado", async () => {
      const ctx = await setup();
      const res = await api().get(`/api/t/o/${ctx.c}/${ctx.s}/assinatura-falsa.gif`).set("User-Agent", BROWSER);
      expect(res.status).toBe(200);
      expect((await recipientOf(ctx.campaign)).opens).toBe(0);
      expect(await events().countDocuments()).toBe(0);
    });

    it("R-EMAIL-11 clique por pessoa conta clique e também abertura", async () => {
      const ctx = await setup();
      const url = "https://outro.site/p";
      const res = await click(ctx, url, BROWSER);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(url);
      const r = await recipientOf(ctx.campaign);
      expect(r.clicks).toBe(1);
      expect(r.clickedAt).toBeTruthy();
      expect(r.openedAt).toBeTruthy();
    });

    it("R-EMAIL-11 clique segundos depois da entrega (scanner) não conta, mas redireciona", async () => {
      const ctx = await setup(new Date());
      const url = "https://outro.site/p";
      const res = await click(ctx, url, BROWSER);
      expect(res.headers.location).toBe(url);
      expect((await recipientOf(ctx.campaign)).clicks).toBe(0);
    });

    it("R-EMAIL-11 clique de robô não conta, mas redireciona", async () => {
      const ctx = await setup();
      const url = "https://outro.site/p";
      const res = await click(ctx, url, "Googlebot/2.1");
      expect(res.headers.location).toBe(url);
      expect((await recipientOf(ctx.campaign)).clicks).toBe(0);
    });

    it("R-EMAIL-11 clique com assinatura inválida não redireciona para fora (sem redirecionador aberto)", async () => {
      const ctx = await setup();
      const res = await click(ctx, "https://malicioso.site/", BROWSER, "assinatura-falsa");
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(SITE_URL);
      expect((await recipientOf(ctx.campaign)).clicks).toBe(0);
    });

    it("R-EMAIL-11 quem não é destinatário do envio não é registrado", async () => {
      const ctx = await setup();
      const other = await Subscriber.create({ email: "outro@x.dev" });
      const s = String(other._id);
      await api().get(`/api/t/o/${ctx.c}/${s}/${tracking.sign(ctx.c, s)}.gif`).set("User-Agent", BROWSER);
      expect(await events().countDocuments()).toBe(0);
    });
  });
});

describe("cancelamento (R-EMAIL-12)", () => {
  it("R-EMAIL-12 todo envio real tem List-Unsubscribe, One-Click e link no corpo", async () => {
    const [sub] = await subscribers(1);
    const campaign = await Campaign.create({ subject: "Oi", content: "<p>a</p>", audience: { type: "all" } });
    await service.processCampaign(campaign);
    const mail = mailTo(sub.email);

    const unsub = mail.headers["List-Unsubscribe"].slice(1, -1);
    expect(unsub).toContain(`/api/subscribers/unsubscribe/${sub.token}`);
    expect(unsub).toContain(`?c=${campaign._id}`);
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(hrefs(mail.html)).toContain(unsub);
  });

  it("R-EMAIL-12 email de teste também tem os cabeçalhos e o link", async () => {
    await service.sendTest(new Campaign({ subject: "Oi", content: "<p>a</p>" }), "eu@x.dev");
    const mail = mails()[0];
    expect(mail.headers["List-Unsubscribe"]).toMatch(/^<https?:\/\//);
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.html).toContain("/api/subscribers/unsubscribe/");
  });

  it("R-EMAIL-12 cancelar pelo cabeçalho de um envio atribui a saída àquele envio", async () => {
    const [sub] = await subscribers(1);
    const campaign = await Campaign.create({ subject: "Oi", content: "<p>a</p>", audience: { type: "all" } });
    await service.processCampaign(campaign);
    const unsub = new URL(mailTo(sub.email).headers["List-Unsubscribe"].slice(1, -1));

    const res = await api().post(`${unsub.pathname}${unsub.search}`).type("form").send("List-Unsubscribe=One-Click");

    expect(res.status).toBe(200);
    const saved = await Subscriber.findById(sub._id).lean();
    expect(saved.status).toBe("unsubscribed");
    expect(String(saved.unsubscribeCampaign)).toBe(String(campaign._id));
    expect((await Campaign.findById(campaign._id).lean()).recipients[0].unsubscribedAt).toBeTruthy();
  });
});

describe("conteúdo para membros (R-EMAIL-13)", () => {
  const BADGE = "Exclusivo para membros";

  it("R-EMAIL-13 público 'members' ganha o selo e o aviso de não encaminhar", async () => {
    const [sub] = await subscribers(1, { tier: "member" });
    const campaign = await Campaign.create({ subject: "Só membros", content: "<p>a</p>", audience: { type: "members" } });
    await service.processCampaign(campaign);
    const html = mailTo(sub.email).html;
    expect(html).toContain(BADGE);
    expect(html).toContain("não encaminhe");
  });

  it.each(["all", "categories"])("R-EMAIL-13 público '%s' não ganha o selo", async (type) => {
    await subscribers(1, { categories: ["tecnologia"] });
    const campaign = await Campaign.create({
      subject: "Aberto",
      content: "<p>a</p>",
      audience: { type, categories: ["tecnologia"] },
    });
    await service.processCampaign(campaign);
    expect(mails()[0].html).not.toContain(BADGE);
  });

  it("R-EMAIL-13 só membros ativos recebem o envio 'members'", async () => {
    await Subscriber.create({ email: "membro@x.dev", tier: "member" });
    await Subscriber.create({ email: "free@x.dev", tier: "free" });
    await Subscriber.create({ email: "saiu@x.dev", tier: "member", status: "unsubscribed" });
    const campaign = await Campaign.create({ subject: "Só membros", content: "<p>a</p>", audience: { type: "members" } });
    await service.processCampaign(campaign);
    expect(mails().map((m) => m.to)).toEqual(["membro@x.dev"]);
  });
});
