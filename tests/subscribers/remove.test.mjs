import { describe, expect, it } from "vitest";
import { asAdmin, models } from "../helpers.mjs";

const { Campaign, Subscriber } = models;

// BIZ-06 / R-SUB-07: excluir assinante apaga os dados da pessoa, inclusive do
// histórico dos envios, sem mudar os números dos envios
describe("excluir assinante", () => {
  it("o email sai do cadastro e do histórico dos envios; os números ficam", async () => {
    const admin = await asAdmin();
    const gone = await Subscriber.create({ email: "sair@x.dev", name: "Quem sai" });
    const stays = await Subscriber.create({ email: "fica@x.dev" });
    const campaign = await Campaign.create({
      subject: "Novidades",
      status: "sent",
      tracking: true,
      recipients: [
        { subscriber: gone._id, email: gone.email, status: "sent", openedAt: new Date(), clickedAt: new Date() },
        { subscriber: stays._id, email: stays.email, status: "sent" },
      ],
    });
    const statsBefore = campaign.stats();

    const res = await admin.delete(`/api/subscribers/${gone._id}`);
    expect(res.status).toBe(200);

    expect(await Subscriber.exists({ _id: gone._id })).toBeNull();
    const after = await Campaign.findById(campaign._id);
    expect(after.recipients.map((r) => r.email)).toEqual(["(removido)", "fica@x.dev"]);
    expect(after.stats()).toEqual(statsBefore);
    // A busca de envios por email não encontra mais a pessoa
    const search = await admin.get("/api/campaigns?email=sair@x.dev");
    expect(search.body).toEqual([]);
  });

  it("vale para todos os envios que a pessoa recebeu", async () => {
    const admin = await asAdmin();
    const gone = await Subscriber.create({ email: "sair@x.dev" });
    for (const subject of ["Um", "Dois"]) {
      await Campaign.create({ subject, status: "sent", recipients: [{ subscriber: gone._id, email: gone.email, status: "sent" }] });
    }
    await admin.delete(`/api/subscribers/${gone._id}`);
    expect(await Campaign.countDocuments({ "recipients.email": "sair@x.dev" })).toBe(0);
  });

  it("assinante inexistente: 404", async () => {
    const admin = await asAdmin();
    expect((await admin.delete("/api/subscribers/64b000000000000000000000")).status).toBe(404);
  });
});
