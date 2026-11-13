import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { api, asAdmin, models } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const { generateSecret, codeAt, currentStep } = require("../../app/utils/totp");
const { seal } = require("../../app/utils/secretBox");

const ALL_ON = { skins: true, terminalOffer: true, toc: true, readingProgress: true };

// Admin com app autenticador de verdade: o código muda a cada passo de 30 s
async function adminWithApp() {
  const secret = generateSecret();
  const admin = await asAdmin({ mfa: { enabledAt: new Date(), secret: seal(secret) } });
  const codeFor = (delta = 0) => codeAt(secret, currentStep() + delta);
  return { admin, codeFor };
}

// Recursos do blog ligados/desligados pelo painel, com dupla confirmação
describe("recursos do blog", () => {
  it("sem nada salvo, tudo ligado e com cache curto", async () => {
    const res = await api().get("/api/settings/features");
    expect(res.status).toBe(200);
    expect(res.body.features).toEqual(ALL_ON);
    expect(res.headers["cache-control"]).toContain("s-maxage=30");
  });

  it("admin desliga com o código do app e o público vê", async () => {
    const { admin, codeFor } = await adminWithApp();
    const res = await admin.patch("/api/settings/features").send({ toc: false, code: codeFor() });
    expect(res.status).toBe(200);
    expect(res.body.features).toEqual({ ...ALL_ON, toc: false });

    const pub = await api().get("/api/settings/features");
    expect(pub.body.features.toc).toBe(false);
  });

  it("sem código: recusa e não muda nada", async () => {
    const { admin } = await adminWithApp();
    const res = await admin.patch("/api/settings/features").send({ toc: false });
    expect(res.status).toBe(422);
    expect((await api().get("/api/settings/features")).body.features.toc).toBe(true);
  });

  it("código errado: 403 (não derruba a sessão) e não muda nada", async () => {
    const { admin, codeFor } = await adminWithApp();
    const wrong = String((Number(codeFor()) + 1) % 1000000).padStart(6, "0");
    const res = await admin.patch("/api/settings/features").send({ skins: false, code: wrong });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/incorreto/);
    expect((await api().get("/api/settings/features")).body.features.skins).toBe(true);
  });

  it("o mesmo código não vale duas vezes", async () => {
    const { admin, codeFor } = await adminWithApp();
    const code = codeFor();
    expect((await admin.patch("/api/settings/features").send({ toc: false, code })).status).toBe(200);
    const again = await admin.patch("/api/settings/features").send({ toc: true, code });
    expect(again.status).toBe(403);
    expect(again.body.error).toMatch(/já foi usado/);
    // O código seguinte do app vale
    expect((await admin.patch("/api/settings/features").send({ toc: true, code: codeFor(1) })).status).toBe(200);
  });

  it("admin sem app autenticador cadastrado não muda", async () => {
    const admin = await asAdmin();
    const res = await admin.patch("/api/settings/features").send({ toc: false, code: "123456" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Cadastre/);
  });

  it("5 códigos errados bloqueiam por um tempo", async () => {
    const { admin, codeFor } = await adminWithApp();
    const wrong = String((Number(codeFor()) + 1) % 1000000).padStart(6, "0");
    for (let i = 0; i < 5; i++) await admin.patch("/api/settings/features").send({ toc: false, code: wrong });
    const res = await admin.patch("/api/settings/features").send({ toc: false, code: codeFor() });
    expect(res.status).toBe(429);
  });

  it("sem login não altera", async () => {
    const res = await api().patch("/api/settings/features").send({ toc: false, code: "123456" });
    expect([401, 403]).toContain(res.status);
  });

  it("recusa valor que não é true/false e pedido sem recurso", async () => {
    const { admin, codeFor } = await adminWithApp();
    expect((await admin.patch("/api/settings/features").send({ toc: "nao", code: codeFor() })).status).toBe(422);
    expect((await admin.patch("/api/settings/features").send({ code: codeFor() })).status).toBe(422);
  });

  it("ignora nome desconhecido", async () => {
    const { admin, codeFor } = await adminWithApp();
    const res = await admin.patch("/api/settings/features").send({ toc: false, hack: true, code: codeFor() });
    expect(res.status).toBe(200);
    expect(res.body.features).not.toHaveProperty("hack");
    const doc = await models.User.findById(admin.user._id).select("+mfa.lastStep").lean();
    expect(doc.mfa.lastStep).toBeGreaterThan(0);
  });

  it("estado do painel sem cache", async () => {
    const admin = await asAdmin();
    const res = await admin.get("/api/settings/features/admin");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.features).toEqual(ALL_ON);
  });
});
