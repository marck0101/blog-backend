import { describe, expect, it } from "vitest";
import { api, asAdmin } from "../helpers.mjs";

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
});
