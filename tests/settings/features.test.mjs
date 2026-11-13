import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it } from "vitest";
import { api, asAdmin, createAdmin, models, sessionCookie } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const { forgetPublic } = require("../../app/routes/settings.routes");

// O banco é limpo entre testes; a memória de 30 s da leitura pública também
beforeEach(() => forgetPublic());

const ALL_ON = { skins: true, terminalOffer: true, toc: true, readingProgress: true };

// Recursos do blog ligados/desligados pelo painel
describe("recursos do blog", () => {
  it("sem nada salvo, tudo ligado e com cache curto", async () => {
    const res = await api().get("/api/settings/features");
    expect(res.status).toBe(200);
    expect(res.body.features).toEqual(ALL_ON);
    expect(res.headers["cache-control"]).toContain("s-maxage=30");
  });

  it("admin desliga um recurso e o público vê", async () => {
    const admin = await asAdmin();
    const res = await admin.patch("/api/settings/features").send({ toc: false });
    expect(res.status).toBe(200);
    expect(res.body.features).toEqual({ ...ALL_ON, toc: false });

    const pub = await api().get("/api/settings/features");
    expect(pub.body.features.toc).toBe(false);

    const back = await admin.patch("/api/settings/features").send({ toc: true, skins: false });
    expect(back.body.features).toEqual({ ...ALL_ON, skins: false });
  });

  it("sem login não altera", async () => {
    const res = await api().patch("/api/settings/features").send({ toc: false });
    expect([401, 403]).toContain(res.status);
  });

  it("recusa valor que não é true/false e corpo vazio", async () => {
    const admin = await asAdmin();
    expect((await admin.patch("/api/settings/features").send({ toc: "nao" })).status).toBe(422);
    expect((await admin.patch("/api/settings/features").send({})).status).toBe(422);
  });

  it("ignora nome desconhecido", async () => {
    const admin = await asAdmin();
    const res = await admin.patch("/api/settings/features").send({ toc: false, hack: true });
    expect(res.status).toBe(200);
    expect(res.body.features).not.toHaveProperty("hack");
  });

  it("estado do painel sem cache", async () => {
    const admin = await asAdmin();
    const res = await admin.get("/api/settings/features/admin");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.features).toEqual(ALL_ON);
  });

  it("CSRF: sessão válida vinda de outra origem não altera", async () => {
    const user = await createAdmin();
    const res = await api()
      .patch("/api/settings/features")
      .set("Cookie", sessionCookie(user))
      .set("Origin", "https://evil.example")
      .send({ skins: false });
    expect(res.status).toBe(403);
    expect((await api().get("/api/settings/features")).body.features.skins).toBe(true);
  });

  it("CSRF: sessão válida sem Origin não altera", async () => {
    const user = await createAdmin();
    const res = await api().patch("/api/settings/features").set("Cookie", sessionCookie(user)).send({ skins: false });
    expect(res.status).toBe(403);
  });

  it("token forjado: alg none e outra chave são recusados", async () => {
    const user = await createAdmin();
    const payload = { id: String(user._id), role: "admin", mfa: true, v: 0 };
    const none = jwt.sign(payload, null, { algorithm: "none" });
    const otherKey = jwt.sign(payload, "chave-de-quem-tentou", { algorithm: "HS256" });
    for (const token of [none, otherKey]) {
      const res = await api().patch("/api/settings/features").set("Authorization", `Bearer ${token}`).send({ skins: false });
      expect(res.status).toBe(401);
    }
  });

  it("sessão antes do 2º fator não altera", async () => {
    const user = await createAdmin();
    const res = await api()
      .patch("/api/settings/features")
      .set("Cookie", sessionCookie(user, { mfa: false }))
      .set("Origin", "http://localhost:5173")
      .send({ skins: false });
    expect(res.status).toBe(401);
  });

  it("não aceita operador do MongoDB nem nome com ponto", async () => {
    const admin = await asAdmin();
    const res = await admin.patch("/api/settings/features").send({ toc: false, $set: { "features.x": true }, "features.hack": true, key: "outro" });
    expect(res.status).toBe(200);
    const doc = await models.SiteSettings.findOne({ key: "site" }).lean();
    // Só nomes de recurso conhecidos (o que não foi salvo fica no padrão na leitura)
    const known = ["readingProgress", "skins", "terminalOffer", "toc"];
    expect(Object.keys(doc.features).every((k) => known.includes(k))).toBe(true);
    expect(doc.features.toc).toBe(false);
    expect(doc).not.toHaveProperty("features.x");
    expect(doc.key).toBe("site");
    expect(await models.SiteSettings.countDocuments()).toBe(1);
  });

  it("?parametro=aleatório não vai ao banco a cada pedido (memória de 30 s)", async () => {
    const first = await api().get("/api/settings/features?_=1");
    expect(first.body.features.toc).toBe(true);
    // Muda direto no banco: a leitura pública segue a memória até expirar
    await models.SiteSettings.create({ key: "site", features: { toc: false } });
    const second = await api().get("/api/settings/features?_=2");
    expect(second.body.features.toc).toBe(true);
    forgetPublic();
    expect((await api().get("/api/settings/features?_=3")).body.features.toc).toBe(false);
  });

  it("salvar no painel vale na hora para a leitura pública", async () => {
    await api().get("/api/settings/features");
    const admin = await asAdmin();
    await admin.patch("/api/settings/features").send({ readingProgress: false });
    expect((await api().get("/api/settings/features")).body.features.readingProgress).toBe(false);
  });
});
