import { describe, expect, it } from "vitest";
import { api, asAdmin, createPost, models } from "../helpers.mjs";

const { BlogPost, PostRevision, Season } = models;

// TEST-05: histórico de versões (SISTEMA.md, seção 10: R-REV-01 a 04).
// O básico (v1/v2, salvar igual, restaurar) está em rules.test.mjs; aqui, o resto.

const CONTENT = "<p>Conteúdo com mais de dez caracteres.</p>";
const newPost = (overrides = {}) => ({ title: "Post de teste", category: "tecnologia", content: CONTENT, ...overrides });
const versions = (id) => PostRevision.find({ post: id }).sort({ version: 1 }).lean();

async function create(admin, overrides) {
  const res = await admin.post("/api/posts").send(newPost(overrides));
  expect(res.status).toBe(201);
  return res.body;
}
// Editar pelo painel manda o slug atual junto (senão mudar o título geraria outro endereço)
const edit = (admin, post, fields) => admin.put(`/api/posts/${post._id}`).send({ slug: post.slug, ...fields });

describe("o que gera versão (R-REV-01)", () => {
  it("cada campo que o leitor vê gera versão e aparece em `changes`", async () => {
    const admin = await asAdmin();
    await Season.create({ title: "Série de teste", slug: "serie-de-teste" });
    const post = await create(admin);

    const steps = [
      [{ title: "Título novo" }, "title"],
      [{ excerpt: "Um resumo novo" }, "excerpt"],
      [{ content: "<p>Outro conteúdo, também longo.</p>" }, "content"],
      [{ category: "marketing" }, "category"],
      [{ season: "serie-de-teste" }, "season"],
      [{ seasonOrder: 3 }, "seasonOrder"],
      [{ coverImageAlt: "Texto alternativo da capa" }, "coverImageAlt"],
      [{ faq: [{ question: "Pergunta?", answer: "Resposta." }] }, "faq"],
      [{ seo: { title: "Título SEO", description: "Descrição SEO" } }, "seo"],
    ];
    for (const [fields, changed] of steps) {
      const res = await edit(admin, post, fields);
      expect(res.status, changed).toBe(200);
      const last = (await versions(post._id)).at(-1);
      expect(last.changes, changed).toContain(changed);
    }

    // v1 (criação) + uma versão por passo
    expect((await versions(post._id)).map((v) => v.version)).toEqual(Array.from({ length: steps.length + 1 }, (_, i) => i + 1));
  });

  it("a versão guarda o estado inteiro e um resumo para a lista", async () => {
    const admin = await asAdmin();
    const post = await create(admin, { title: "Com imagem", content: '<p>Texto</p><img src="https://x.dev/a.png" alt="a">' });
    const [v1] = await versions(post._id);
    expect(v1).toMatchObject({ version: 1, reason: "create" });
    expect(v1.snapshot).toMatchObject({ title: "Com imagem", category: "tecnologia" });
    expect(v1.summary).toMatchObject({ title: "Com imagem", images: 1 });
    expect(v1.summary.chars).toBe(v1.snapshot.content.length);
  });

  it("gravação sem mudança não cria versão, nem repetida", async () => {
    const admin = await asAdmin();
    const post = await create(admin);
    for (let i = 0; i < 3; i++) await edit(admin, post, { title: post.title });
    expect(await PostRevision.countDocuments({ post: post._id })).toBe(1);
  });

  it("post antigo, sem histórico: a 1ª edição guarda o estado anterior como v1 (baseline) e a edição como v2", async () => {
    const admin = await asAdmin();
    const old = await createPost({ title: "Post antigo", slug: "post-antigo" });
    expect(await PostRevision.countDocuments({ post: old._id })).toBe(0);

    const res = await admin.put(`/api/posts/${old._id}`).send({ slug: "post-antigo", title: "Post antigo editado" });
    expect(res.status).toBe(200);

    const list = await versions(old._id);
    expect(list.map((v) => [v.version, v.reason])).toEqual([[1, "baseline"], [2, "edit"]]);
    expect(list[0].snapshot.title).toBe("Post antigo");
    expect(list[1].changes).toEqual(["title"]);
  });
});

describe("o que NÃO gera versão (R-REV-02)", () => {
  it("status, data, email e LinkedIn não entram no histórico", async () => {
    const admin = await asAdmin();
    const post = await create(admin);

    const outsideHistory = [
      { status: "published" },
      { status: "draft" },
      { plannedAt: "2030-01-10" },
      { sendEmail: false },
      { emailTeaser: "Chamada do email" },
      { linkedin: { enabled: true } },
    ];
    for (const fields of outsideHistory) {
      const res = await edit(admin, post, fields);
      expect(res.status, JSON.stringify(fields)).toBe(200);
    }
    expect(await PostRevision.countDocuments({ post: post._id })).toBe(1);
  });

  it("restaurar versão não despublica, não reagenda e não mexe no que está fora do histórico", async () => {
    const admin = await asAdmin();
    const post = await create(admin, { title: "Primeira versão" });
    await edit(admin, post, { title: "Segunda versão", status: "published" });
    // Vitrine tem rota própria (/showcase/pinned); aqui só importa que a restauração não a desfaz
    await BlogPost.updateOne({ _id: post._id }, { $set: { pinnedOrder: 1 } });
    const before = await BlogPost.findById(post._id).lean();

    const res = await admin.post(`/api/posts/${post._id}/revisions/1/restore`);
    expect(res.status).toBe(200);

    const after = await BlogPost.findById(post._id).lean();
    expect(after.title).toBe("Primeira versão");
    expect(after.status).toBe("published");
    expect(after.published).toBe(true);
    expect(after.publishedAt).toEqual(before.publishedAt);
    expect(after.pinnedOrder).toBe(1);
  });

  it("restaurar um agendado mantém o agendamento", async () => {
    const admin = await asAdmin();
    const post = await create(admin, { title: "Agendada v1" });
    await edit(admin, post, { title: "Agendada v2", status: "planned", plannedAt: "2030-05-20" });
    const before = await BlogPost.findById(post._id).lean();

    await admin.post(`/api/posts/${post._id}/revisions/1/restore`);

    const after = await BlogPost.findById(post._id).lean();
    expect(after.title).toBe("Agendada v1");
    expect(after.status).toBe("planned");
    expect(after.plannedAt).toEqual(before.plannedAt);
  });
});

describe("restaurar (R-REV-03)", () => {
  it("cria versão nova com o conteúdo antigo e nada do histórico é apagado", async () => {
    const admin = await asAdmin();
    const post = await create(admin, { title: "Original", content: "<p>Texto original do post.</p>" });
    await edit(admin, post, { title: "Mudado", content: "<p>Texto mudado do post.</p>" });

    await admin.post(`/api/posts/${post._id}/revisions/1/restore`);

    const list = await versions(post._id);
    expect(list.map((v) => v.version)).toEqual([1, 2, 3]);
    // As antigas continuam intactas
    expect(list[0].snapshot.title).toBe("Original");
    expect(list[1].snapshot.title).toBe("Mudado");
    expect(list[2]).toMatchObject({ reason: "restore", restoredFrom: 1 });
    expect(list[2].snapshot).toMatchObject({ title: "Original", content: "<p>Texto original do post.</p>" });
    expect(list[2].changes).toEqual(expect.arrayContaining(["title", "content"]));
  });

  it("mantém o slug atual mesmo que a versão tenha outro (não quebra links)", async () => {
    const admin = await asAdmin();
    const post = await create(admin, { title: "Slug original" });
    await edit(admin, post, { title: "Slug novo", slug: "endereco-novo" });
    expect((await BlogPost.findById(post._id).lean()).slug).toBe("endereco-novo");

    const res = await admin.post(`/api/posts/${post._id}/revisions/1/restore`);
    expect(res.status).toBe(200);
    const after = await BlogPost.findById(post._id).lean();
    expect(after.title).toBe("Slug original");
    expect(after.slug).toBe("endereco-novo");
  });

  it("season apagada depois da versão: o post fica na season atual", async () => {
    const admin = await asAdmin();
    await Season.create({ title: "Passageira", slug: "passageira" });
    await Season.create({ title: "Atual", slug: "atual" });
    const post = await create(admin, { title: "Com season", season: "passageira" });
    await edit(admin, post, { season: "atual" });
    // A season da v1 deixa de existir
    await BlogPost.updateMany({ season: "passageira" }, { $set: { season: null } });
    await Season.deleteOne({ slug: "passageira" });

    const res = await admin.post(`/api/posts/${post._id}/revisions/1/restore`);
    expect(res.status).toBe(200);
    expect((await BlogPost.findById(post._id).lean()).season).toBe("atual");
  });

  it("restaurar a versão que já é a atual não cria versão repetida", async () => {
    const admin = await asAdmin();
    const post = await create(admin);
    const res = await admin.post(`/api/posts/${post._id}/revisions/1/restore`);
    expect(res.status).toBe(200);
    expect(await PostRevision.countDocuments({ post: post._id })).toBe(1);
  });

  it("versão ou post inexistente: 404; número de versão inválido: 404", async () => {
    const admin = await asAdmin();
    const post = await create(admin);
    expect((await admin.post(`/api/posts/${post._id}/revisions/99/restore`)).status).toBe(404);
    expect((await admin.post(`/api/posts/${post._id}/revisions/abc/restore`)).status).toBe(404);
    expect((await admin.post(`/api/posts/${post._id}/revisions/0/restore`)).status).toBe(404);
    expect((await admin.post("/api/posts/64b000000000000000000000/revisions/1/restore")).status).toBe(404);
  });

  it("HTML antigo e inseguro volta já limpo", async () => {
    const admin = await asAdmin();
    const post = await createPost({ title: "Antigo inseguro", slug: "antigo-inseguro" });
    // Versão gravada antes da limpeza de HTML (SEC-01)
    await PostRevision.create({
      post: post._id,
      version: 1,
      hash: "antigo",
      snapshot: { title: "Antigo inseguro", slug: "antigo-inseguro", content: '<p>Texto seguro aqui.</p><script>alert(1)</script>', category: "tecnologia" },
    });
    const res = await admin.post(`/api/posts/${post._id}/revisions/1/restore`);
    expect(res.status).toBe(200);
    const saved = await BlogPost.findById(post._id).lean();
    expect(saved.content).toContain("Texto seguro aqui.");
    expect(saved.content).not.toContain("<script");
  });
});

describe("leitura do histórico (painel)", () => {
  it("lista da mais nova para a mais antiga, sem o conteúdo; uma versão traz tudo", async () => {
    const admin = await asAdmin();
    const post = await create(admin, { title: "Listada" });
    await edit(admin, post, { title: "Listada de novo" });

    const list = await admin.get(`/api/posts/${post._id}/revisions`);
    expect(list.status).toBe(200);
    expect(list.body.map((v) => v.version)).toEqual([2, 1]);
    expect(list.body[0]).not.toHaveProperty("snapshot");

    const one = await admin.get(`/api/posts/${post._id}/revisions/1`);
    expect(one.status).toBe(200);
    expect(one.body.snapshot.title).toBe("Listada");

    expect((await admin.get(`/api/posts/${post._id}/revisions/7`)).status).toBe(404);
    expect((await admin.get("/api/posts/64b000000000000000000000/revisions")).status).toBe(404);
  });

  it("só o admin lê e restaura", async () => {
    const admin = await asAdmin();
    const post = await create(admin);
    expect((await api().get(`/api/posts/${post._id}/revisions`)).status).toBe(401);
    expect((await api().get(`/api/posts/${post._id}/revisions/1`)).status).toBe(401);
    expect((await api().post(`/api/posts/${post._id}/revisions/1/restore`)).status).toBe(401);
  });
});

describe("quando as versões somem (R-REV-04)", () => {
  it("mandar para a lixeira e restaurar mantém o histórico", async () => {
    const admin = await asAdmin();
    const post = await create(admin);
    await edit(admin, post, { title: "Editado antes da lixeira" });

    await admin.delete(`/api/posts/${post._id}`);
    expect(await PostRevision.countDocuments({ post: post._id })).toBe(2);
    await admin.patch(`/api/posts/${post._id}/restore`);
    expect(await PostRevision.countDocuments({ post: post._id })).toBe(2);
  });

  it("só a exclusão definitiva apaga as versões, e só as desse post", async () => {
    const admin = await asAdmin();
    const gone = await create(admin, { title: "Vai embora" });
    const stays = await create(admin, { title: "Fica aqui" });
    await edit(admin, gone, { title: "Vai embora editado" });

    await admin.delete(`/api/posts/${gone._id}`);
    expect((await admin.delete(`/api/posts/${gone._id}/hard`)).status).toBe(200);

    expect(await PostRevision.countDocuments({ post: gone._id })).toBe(0);
    expect(await PostRevision.countDocuments({ post: stays._id })).toBe(1);
  });
});
