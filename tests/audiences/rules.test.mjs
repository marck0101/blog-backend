import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { asAdmin, createPost, models } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const AudienceList = require("../../app/models/audienceList.model");
const { BlogPost, Campaign, Subscriber } = models;

// TEST-06: públicos nomeados (SISTEMA.md, seção 6.3, R-LIST-01 a 05)

// O índice único (com collation) é criado em segundo plano na primeira conexão:
// espera ele existir, como em produção, onde a app já está de pé
beforeAll(() => AudienceList.init());

const createList = (admin, name = "Clientes") => admin.post("/api/audiences").send({ name });

describe("nome único (R-LIST-01)", () => {
  it("não diferencia maiúsculas: 409", async () => {
    const admin = await asAdmin();
    expect((await createList(admin, "Evento São Paulo")).status).toBe(201);
    for (const name of ["evento são paulo", "EVENTO SÃO PAULO"]) {
      const res = await createList(admin, name);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Já existe um público/);
    }
    expect(await AudienceList.countDocuments()).toBe(1);
  });

  // BUG CONHECIDO (achado no TEST-06): o SISTEMA.md diz "sem diferenciar maiúsculas/acentos",
  // mas o índice único usa collation strength 2 (ignora só maiúsculas). Corrigir exige
  // trocar o índice em produção (strength 1), então fica documentado aqui. Quando for
  // corrigido, este teste passa a falhar: troque `it.fails` por `it`.
  it.fails("não diferencia acentos: 'Sao' e 'São' são o mesmo nome (R-LIST-01)", async () => {
    const admin = await asAdmin();
    expect((await createList(admin, "Evento São Paulo")).status).toBe(201);
    expect((await createList(admin, "Evento Sao Paulo")).status).toBe(409);
  });

  it("renomear para o nome de outro: 409; para o próprio nome: ok", async () => {
    const admin = await asAdmin();
    const a = (await createList(admin, "Alfa")).body;
    await createList(admin, "Beta");
    expect((await admin.patch(`/api/audiences/${a._id}`).send({ name: "beta" })).status).toBe(409);
    expect((await admin.patch(`/api/audiences/${a._id}`).send({ name: "ALFA" })).status).toBe(200);
  });

  it("nome igual ao de um público na lixeira avisa que dá para restaurar", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin, "Antigo")).body;
    await admin.delete(`/api/audiences/${list._id}`);
    const res = await createList(admin, "antigo");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/na lixeira/);
  });
});

describe("importação (R-LIST-02)", () => {
  const importRows = (admin, id, body) => admin.post(`/api/audiences/${id}/import`).send(body);

  it("sem marcar que as pessoas autorizaram: 422 e ninguém é criado", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin)).body;
    const rows = [{ email: "a@teste.dev" }];
    const semConsent = await importRows(admin, list._id, { rows });
    expect(semConsent.status).toBe(422);
    expect(semConsent.body.error).toMatch(/autorizaram/);
    expect((await importRows(admin, list._id, { rows, consent: false })).status).toBe(422);
    expect(await Subscriber.countDocuments()).toBe(0);
  });

  it("até 1000 linhas por chamada: 1001 é recusado", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin)).body;
    const rows = (n) => Array.from({ length: n }, (_, i) => ({ email: `p${i}@teste.dev` }));

    const tooMany = await importRows(admin, list._id, { consent: true, rows: rows(1001) });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error).toMatch(/1000/);
    expect(await Subscriber.countDocuments()).toBe(0);

    const ok = await importRows(admin, list._id, { consent: true, rows: rows(1000) });
    expect(ok.status).toBe(200);
    expect(ok.body.created).toBe(1000);
  });

  it("novos viram assinantes ativos, gratuitos, com origem 'import'; repetidos e inválidos vão no resumo", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin, "Evento")).body;
    const res = await importRows(admin, list._id, {
      consent: true,
      categories: ["design"],
      rows: [{ email: "Novo@Teste.dev", name: "Novo" }, { email: "novo@teste.dev" }, { email: "lixo" }],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1, duplicatesInFile: 1 });
    expect(res.body.invalid).toHaveLength(1);

    const sub = await Subscriber.findOne({ email: "novo@teste.dev" }).lean();
    expect(sub).toMatchObject({ status: "active", tier: "free", name: "Novo", categories: ["design"] });
    expect(sub.source.location).toBe("import");
    expect(sub.lists.map(String)).toEqual([list._id]);
  });

  it("quem já existe só entra no público; quem cancelou continua cancelado", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin)).body;
    const ativo = await Subscriber.create({ email: "ativo@teste.dev", categories: ["growth"] });
    const saiu = await Subscriber.create({ email: "saiu@teste.dev", status: "unsubscribed" });

    const res = await importRows(admin, list._id, { consent: true, rows: [{ email: "ativo@teste.dev", name: "Nome novo" }, { email: "saiu@teste.dev" }] });
    expect(res.body).toMatchObject({ created: 0, added: 1, unsubscribed: 1 });

    const a = await Subscriber.findById(ativo._id).lean();
    expect(a.lists.map(String)).toEqual([list._id]);
    expect(a.categories).toEqual(["growth"]);
    expect((await Subscriber.findById(saiu._id).lean()).status).toBe("unsubscribed");

    // Importar de novo não duplica o vínculo
    const again = await importRows(admin, list._id, { consent: true, rows: [{ email: "ativo@teste.dev" }] });
    expect(again.body.alreadyInList).toBe(1);
    expect((await Subscriber.findById(ativo._id).lean()).lists).toHaveLength(1);
  });

  it("público na lixeira não recebe importação: 404", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin)).body;
    await admin.delete(`/api/audiences/${list._id}`);
    expect((await importRows(admin, list._id, { consent: true, rows: [{ email: "a@teste.dev" }] })).status).toBe(404);
  });
});

describe("lixeira (R-LIST-03)", () => {
  it("some do painel e vai para a lixeira, mas as pessoas continuam ligadas; restaurar devolve tudo", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin)).body;
    const sub = await Subscriber.create({ email: "p@teste.dev", lists: [list._id] });

    expect((await admin.delete(`/api/audiences/${list._id}`)).status).toBe(200);
    expect((await admin.get("/api/audiences")).body).toEqual([]);
    const trash = (await admin.get("/api/audiences/trash")).body;
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({ _id: list._id, total: 1, active: 1 });
    expect((await Subscriber.findById(sub._id).lean()).lists.map(String)).toEqual([list._id]);

    expect((await admin.patch(`/api/audiences/${list._id}/restore`).send()).status).toBe(200);
    const active = (await admin.get("/api/audiences")).body;
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ _id: list._id, total: 1, active: 1 });
  });

  it("lista conta total e ativos; restaurar quem não está na lixeira: 404; editar na lixeira: 404", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin)).body;
    await Subscriber.create({ email: "a@teste.dev", lists: [list._id] });
    await Subscriber.create({ email: "b@teste.dev", lists: [list._id], status: "unsubscribed" });
    expect((await admin.get("/api/audiences")).body[0]).toMatchObject({ total: 2, active: 1 });

    expect((await admin.patch(`/api/audiences/${list._id}/restore`).send()).status).toBe(404);
    await admin.delete(`/api/audiences/${list._id}`);
    expect((await admin.patch(`/api/audiences/${list._id}`).send({ name: "Novo nome" })).status).toBe(404);
  });
});

describe("não apagar o que está em uso (R-LIST-04)", () => {
  it("envio em rascunho usando o público: 409 e o público fica", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin)).body;
    await Campaign.create({ subject: "Rascunho", status: "draft", audience: { type: "lists", lists: [list._id] } });

    const res = await admin.delete(`/api/audiences/${list._id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/1 envio\(s\) em rascunho/);
    expect((await AudienceList.findById(list._id).lean()).deletedAt).toBeNull();
  });

  it("email de post ainda não publicado usando o público: 409; post publicado não bloqueia", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin)).body;
    const draft = await createPost({ emailAudience: { type: "lists", lists: [list._id] } });

    const blocked = await admin.delete(`/api/audiences/${list._id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/1 post\(s\) não publicado\(s\)/);

    await BlogPost.updateOne({ _id: draft._id }, { published: true, status: "published", publishedAt: new Date() });
    expect((await admin.delete(`/api/audiences/${list._id}`)).status).toBe(200);
  });

  it("envio já enviado usando o público não bloqueia", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin)).body;
    await Campaign.create({ subject: "Enviado", status: "sent", audience: { type: "lists", lists: [list._id] } });
    expect((await admin.delete(`/api/audiences/${list._id}`)).status).toBe(200);
  });

  it("a mesma trava vale para excluir de vez", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin)).body;
    await AudienceList.updateOne({ _id: list._id }, { deletedAt: new Date() });
    await Campaign.create({ subject: "Rascunho", status: "draft", audience: { type: "lists", lists: [list._id] } });
    expect((await admin.delete(`/api/audiences/${list._id}/hard`)).status).toBe(409);
    expect(await AudienceList.countDocuments()).toBe(1);
  });
});

describe("excluir de vez (R-LIST-05)", () => {
  it("só da lixeira: fora dela, 404", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin)).body;
    expect((await admin.delete(`/api/audiences/${list._id}/hard`)).status).toBe(404);
    expect(await AudienceList.countDocuments()).toBe(1);
  });

  it("apaga o público, desfaz o vínculo e as pessoas continuam assinantes", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin)).body;
    const other = (await createList(admin, "Outro")).body;
    const sub = await Subscriber.create({ email: "p@teste.dev", lists: [list._id, other._id] });
    await admin.delete(`/api/audiences/${list._id}`);

    expect((await admin.delete(`/api/audiences/${list._id}/hard`)).status).toBe(200);

    expect(await AudienceList.findById(list._id)).toBeNull();
    const saved = await Subscriber.findById(sub._id).lean();
    expect(saved.status).toBe("active");
    expect(saved.lists.map(String)).toEqual([other._id]);
  });

  it("tirar uma pessoa do público não a cancela", async () => {
    const admin = await asAdmin();
    const list = (await createList(admin)).body;
    const sub = await Subscriber.create({ email: "p@teste.dev", lists: [list._id] });
    expect((await admin.delete(`/api/audiences/${list._id}/members/${sub._id}`)).status).toBe(200);
    const saved = await Subscriber.findById(sub._id).lean();
    expect(saved.lists).toEqual([]);
    expect(saved.status).toBe("active");
  });
});
