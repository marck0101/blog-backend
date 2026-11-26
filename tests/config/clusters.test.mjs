import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { api, asAdmin, models } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const CLUSTERS = require("../../app/config/clusters");
const { BlogPost } = models;

const base = { title: "Post de tema", category: "tecnologia" };

// R-CLU-01 / R-CLU-02: temas numa lista só e no máximo um pilar por tema
describe("temas (clusters)", () => {
  it("/api/clusters devolve a lista do config", async () => {
    const res = await api().get("/api/clusters");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(CLUSTERS.map((c) => ({ ...c })));
    // Segurança não tem pilar: a season é a porta de entrada
    expect(res.body.find((c) => c.slug === "seguranca-na-diretoria").season).toBe("seguranca-e-pauta-de-diretoria");
  });

  it("o model aceita os temas do config e nenhum tema", () => {
    expect(BlogPost.schema.path("cluster").enumValues).toEqual([...CLUSTERS.SLUGS, null]);
  });

  it("tema fora da lista: 422", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/posts").send({ ...base, cluster: "inexistente" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/^Tema inválido/);
  });

  it("pilar sem tema: 422", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/posts").send({ ...base, isPillar: true });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Escolha o tema antes de marcar o post como pilar");
  });

  it("novo pilar tira a marca do anterior do mesmo tema, não de outro tema", async () => {
    const admin = await asAdmin();
    const [slugA, slugB] = CLUSTERS.SLUGS;
    const first = (await admin.post("/api/posts").send({ ...base, title: "Pilar 1", cluster: slugA, isPillar: true })).body;
    const other = (await admin.post("/api/posts").send({ ...base, title: "Pilar B", cluster: slugB, isPillar: true })).body;
    const second = (await admin.post("/api/posts").send({ ...base, title: "Satélite", cluster: slugA })).body;

    const res = await admin.put(`/api/posts/${second._id}`).send({ isPillar: true });
    expect(res.status).toBe(200);

    const pillars = await BlogPost.find({ isPillar: true }).select("title cluster").lean();
    expect(pillars.map((p) => p.title).sort()).toEqual(["Pilar B", "Satélite"]);
    expect((await BlogPost.findById(first._id).lean()).isPillar).toBe(false);
    expect((await BlogPost.findById(other._id).lean()).isPillar).toBe(true);
  });

  it("tirar o tema tira também a marca de pilar", async () => {
    const admin = await asAdmin();
    const post = (await admin.post("/api/posts").send({ ...base, cluster: CLUSTERS.SLUGS[0], isPillar: true })).body;
    await admin.put(`/api/posts/${post._id}`).send({ cluster: "" });
    const saved = await BlogPost.findById(post._id).lean();
    expect(saved).toMatchObject({ cluster: null, isPillar: false });
  });
});
