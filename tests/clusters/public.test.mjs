import { describe, expect, it } from "vitest";
import { api, createPost } from "../helpers.mjs";

const pub = (extra) => createPost({ status: "published", published: true, publishedAt: new Date(), ...extra });

// R-CLU-03: página pública do tema, sitemap e llms.txt
describe("tema público", () => {
  it("devolve o pilar separado dos demais posts do tema, sem rascunho nem lixeira", async () => {
    await pub({ title: "Pilar", slug: "pilar", cluster: "dashboards-e-bi", isPillar: true });
    await pub({ title: "Satélite", slug: "satelite", cluster: "dashboards-e-bi" });
    await pub({ title: "Outro tema", slug: "outro", cluster: "trafego-pago-medido" });
    await createPost({ title: "Rascunho", slug: "rascunho", cluster: "dashboards-e-bi" });
    await pub({ title: "Na lixeira", slug: "lixeira", cluster: "dashboards-e-bi", deletedAt: new Date() });

    const res = await api().get("/api/clusters/dashboards-e-bi");
    expect(res.status).toBe(200);
    expect(res.body.cluster.title).toBe("Dashboards e BI de marketing");
    expect(res.body.pillar.slug).toBe("pilar");
    expect(res.body.posts.map((p) => p.slug)).toEqual(["satelite"]);
    expect(res.body.posts[0].content).toBeUndefined();
    expect(res.body.posts[0].readingMinutes).toBeGreaterThan(0);
  });

  it("tema sem post publicado ou inexistente: 404 (soft=1 devolve null)", async () => {
    expect((await api().get("/api/clusters/dashboards-e-bi")).status).toBe(404);
    expect((await api().get("/api/clusters/nao-existe")).status).toBe(404);
    const soft = await api().get("/api/clusters/nao-existe?soft=1");
    expect(soft.status).toBe(200);
    expect(soft.body).toBeNull();
  });

  it("?withCounts=1 lista só temas com post publicado", async () => {
    await pub({ slug: "a", cluster: "trafego-pago-medido" });
    await pub({ slug: "b", cluster: "trafego-pago-medido" });
    const res = await api().get("/api/clusters?withCounts=1");
    expect(res.body).toEqual([expect.objectContaining({ slug: "trafego-pago-medido", posts: 2 })]);
  });

  it("sitemap e llms.txt incluem só temas com post publicado", async () => {
    await pub({ slug: "post-tema", cluster: "seguranca-na-diretoria", isPillar: true });
    const sitemap = (await api().get("/sitemap.xml")).text;
    expect(sitemap).toContain("/temas/seguranca-na-diretoria");
    expect(sitemap).not.toContain("/temas/dashboards-e-bi");

    const llms = (await api().get("/llms.txt")).text;
    expect(llms).toContain("## Temas");
    expect(llms).toContain("[Segurança é pauta de diretoria](https://blog.marck0101.com.br/temas/seguranca-na-diretoria): 1 artigo(s).");

    const full = (await api().get("/llms-full.txt")).text;
    expect(full).toContain("- Tema: Segurança é pauta de diretoria (artigo principal do tema)");
  });
});

describe("página sobre", () => {
  it("entra no sitemap, no llms.txt e no llms-full.txt", async () => {
    await pub({ slug: "qualquer" });
    expect((await api().get("/sitemap.xml")).text).toContain("<loc>https://blog.marck0101.com.br/sobre</loc>");
    expect((await api().get("/llms.txt")).text).toContain("Quem escreve e onde atua: https://blog.marck0101.com.br/sobre");
    expect((await api().get("/llms-full.txt")).text).toContain("Página do autor: https://blog.marck0101.com.br/sobre");
  });
});
