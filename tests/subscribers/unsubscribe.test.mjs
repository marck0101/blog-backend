import { describe, expect, it } from "vitest";
import { api, models, transporter } from "../helpers.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Subscriber, Campaign } = models;

// SEC-03, R-SUB-06, R-EMAIL-12: cancelar inscrição
describe("cancelar inscrição", () => {
  const createSub = () => Subscriber.create({ email: "leitor@teste.dev", name: "Leitor" });

  it("GET (antivírus abrindo o link) não cancela: só leva à página de confirmação", async () => {
    const sub = await createSub();
    const res = await api().get(`/api/subscribers/unsubscribe/${sub.token}?c=64b000000000000000000001`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/cancelar-inscricao#t=[a-f0-9]{64}&c=64b000000000000000000001$/);
    expect((await Subscriber.findById(sub._id).lean()).status).toBe("active");
  });

  it("GET com ?c= inválido não repassa o parâmetro", async () => {
    const sub = await createSub();
    const res = await api().get(`/api/subscribers/unsubscribe/${sub.token}?c=<script>`);
    expect(res.headers.location).not.toContain("script");
  });

  it("POST cancela e atribui ao envio (botão da página)", async () => {
    const sub = await createSub();
    const campaign = await Campaign.create({
      subject: "Envio",
      status: "sent",
      tracking: true,
      recipients: [{ subscriber: sub._id, email: sub.email, status: "sent" }],
    });
    const res = await api().post(`/api/subscribers/unsubscribe/${sub.token}`).send({ c: String(campaign._id) });
    expect(res.status).toBe(200);

    const saved = await Subscriber.findById(sub._id).lean();
    expect(saved.status).toBe("unsubscribed");
    expect(String(saved.unsubscribeCampaign)).toBe(String(campaign._id));
    const recipient = (await Campaign.findById(campaign._id).lean()).recipients[0];
    expect(recipient.unsubscribedAt).toBeTruthy();
  });

  it("POST de um clique do Gmail/Yahoo (RFC 8058, sem origem, form-urlencoded) cancela", async () => {
    const sub = await createSub();
    const res = await api()
      .post(`/api/subscribers/unsubscribe/${sub.token}?c=64b000000000000000000001`)
      .type("form")
      .send("List-Unsubscribe=One-Click");
    expect(res.status).toBe(200);
    expect((await Subscriber.findById(sub._id).lean()).status).toBe("unsubscribed");
  });

  it("POST repetido não muda a data da saída", async () => {
    const sub = await createSub();
    await api().post(`/api/subscribers/unsubscribe/${sub.token}`);
    const first = (await Subscriber.findById(sub._id).lean()).unsubscribedAt;
    await api().post(`/api/subscribers/unsubscribe/${sub.token}`);
    expect((await Subscriber.findById(sub._id).lean()).unsubscribedAt).toEqual(first);
  });

  it("token inválido ou operador do MongoDB: 404", async () => {
    await createSub();
    expect((await api().post("/api/subscribers/unsubscribe/abc")).status).toBe(404);
    expect((await api().post("/api/subscribers/unsubscribe/%7B%22%24ne%22%3Anull%7D")).status).toBe(404);
  });
});

describe("email enviado", () => {
  it("tem List-Unsubscribe e List-Unsubscribe-Post (um clique)", async () => {
    const { sendTest } = require("../../app/services/campaign.service");
    const campaign = new Campaign({ subject: "Oi", content: "<p>a</p>" });
    await sendTest(campaign, "eu@teste.dev");
    const mail = transporter.sendMail.mock.calls[0][0];
    expect(mail.headers["List-Unsubscribe"]).toMatch(/^<https?:\/\/.+\/api\/subscribers\/unsubscribe\//);
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});
