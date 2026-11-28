import { describe, expect, it } from "vitest";
import { api, asAdmin, models } from "../helpers.mjs";

const { Subscriber } = models;

// TEST-06: regras de assinante (SISTEMA.md, seção 6.1).
// Já cobertos em outros arquivos: R-SUB-06 e R-SUB-09 (subscribers/unsubscribe.test.mjs),
// R-SUB-07 (subscribers/remove.test.mjs).

const subscribe = (body, ip) => {
  const req = api().post("/api/subscribers");
  if (ip) req.set("X-Real-IP", ip);
  return req.send(body);
};

// Lê o corpo como texto (o CSV não é JSON)
const asText = (r, cb) => {
  let data = "";
  r.setEncoding("utf8");
  r.on("data", (c) => (data += c));
  r.on("end", () => cb(null, data));
};

describe("inscrição pública (R-SUB-01 a 04)", () => {
  it("R-SUB-01 grava email, categorias e origem (página, post, UTM, referrer, primeira página)", async () => {
    const res = await subscribe({
      email: "  Novo@Teste.dev ",
      name: "Novo",
      categories: ["tecnologia", "design"],
      source: {
        location: "post",
        path: "/blog/algum-post",
        post: "algum-post",
        landingPath: "/",
        referrer: "https://google.com",
        utmSource: "newsletter",
        utmMedium: "email",
        utmCampaign: "lancamento",
      },
    });
    expect(res.status).toBe(201);

    const saved = await Subscriber.findOne({ email: "novo@teste.dev" }).lean();
    expect(saved).toMatchObject({ status: "active", tier: "free", categories: ["tecnologia", "design"] });
    expect(saved.source).toMatchObject({
      location: "post",
      path: "/blog/algum-post",
      post: "algum-post",
      landingPath: "/",
      referrer: "https://google.com",
      utmSource: "newsletter",
      utmMedium: "email",
      utmCampaign: "lancamento",
    });
  });

  it("R-SUB-01 categorias são opcionais; email inválido e categoria inexistente são recusados", async () => {
    expect((await subscribe({ email: "sem-cat@teste.dev" })).status).toBe(201);
    expect((await Subscriber.findOne({ email: "sem-cat@teste.dev" }).lean()).categories).toEqual([]);
    expect((await subscribe({ email: "nao-e-email" })).status).toBe(422);
    expect((await subscribe({ email: "a@teste.dev", categories: ["nao-existe"] })).status).toBe(422);
    expect(await Subscriber.countDocuments({ email: "a@teste.dev" })).toBe(0);
  });

  it("R-SUB-02 resposta igual para email novo e já inscrito; ativo não é alterado", async () => {
    const first = await subscribe({ email: "dup@teste.dev", name: "Original", categories: ["design"] });
    const before = await Subscriber.findOne({ email: "dup@teste.dev" }).lean();

    const second = await subscribe({ email: "DUP@teste.dev", name: "Outro nome", categories: ["carreira"] });

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    const after = await Subscriber.findOne({ email: "dup@teste.dev" }).lean();
    expect(after.name).toBe("Original");
    expect(after.categories).toEqual(["design"]);
    expect(after.token).toBe(before.token);
    expect(await Subscriber.countDocuments({ email: "dup@teste.dev" })).toBe(1);
  });

  it("R-SUB-03 quem cancelou e se inscreve de novo volta a ativo, com as categorias novas", async () => {
    const old = await Subscriber.create({
      email: "volta@teste.dev",
      name: "Antigo",
      categories: ["design"],
      status: "unsubscribed",
      unsubscribedAt: new Date("2026-01-01T12:00:00Z"),
    });

    const res = await subscribe({ email: "volta@teste.dev", categories: ["carreira", "growth"] });
    expect(res.status).toBe(201);

    const saved = await Subscriber.findById(old._id).lean();
    expect(saved.status).toBe("active");
    expect(saved.categories).toEqual(["carreira", "growth"]);
    expect(saved.unsubscribedAt).toBeNull();
    expect(saved.name).toBe("Antigo");
  });

  it("R-SUB-04 limite: 5 inscrições por IP a cada 30 min; a 6ª recebe 429 com Retry-After", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await subscribe({ email: `lote${i}@teste.dev` }, "203.0.113.7")).status).toBe(201);
    }
    const blocked = await subscribe({ email: "lote5@teste.dev" }, "203.0.113.7");
    expect(blocked.status).toBe(429);
    const retry = Number(blocked.headers["retry-after"]);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(30 * 60);
    expect(await Subscriber.countDocuments({ email: "lote5@teste.dev" })).toBe(0);
  });

  it("R-SUB-04 o limite é por IP: outro IP continua livre", async () => {
    for (let i = 0; i < 5; i++) await subscribe({ email: `ip${i}@teste.dev` }, "203.0.113.7");
    expect((await subscribe({ email: "ip-x@teste.dev" }, "203.0.113.7")).status).toBe(429);
    expect((await subscribe({ email: "ip-y@teste.dev" }, "203.0.113.8")).status).toBe(201);
  });

  it("R-SUB-04 re-inscrição de quem já é assinante também gasta o limite (não revela quem é assinante)", async () => {
    await Subscriber.create({ email: "ja@teste.dev" });
    for (let i = 0; i < 5; i++) expect((await subscribe({ email: "ja@teste.dev" }, "203.0.113.9")).status).toBe(201);
    expect((await subscribe({ email: "ja@teste.dev" }, "203.0.113.9")).status).toBe(429);
  });
});

describe("plano (R-SUB-05)", () => {
  it("inscrição pública entra como free; mudar o plano reinicia o 'membro desde'", async () => {
    const admin = await asAdmin();
    await subscribe({ email: "plano@teste.dev" });
    const sub = await Subscriber.findOne({ email: "plano@teste.dev" }).lean();
    expect(sub.tier).toBe("free");
    expect(sub.memberSince).toBeNull();

    const toMember = await admin.patch(`/api/subscribers/${sub._id}`).send({ tier: "member" });
    expect(toMember.status).toBe(200);
    expect(toMember.body.tier).toBe("member");
    expect(new Date(toMember.body.memberSince).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const toFree = await admin.patch(`/api/subscribers/${sub._id}`).send({ tier: "free" });
    expect(toFree.body.memberSince).toBeNull();

    // Data antiga de membro: ao virar membro de novo, a data é nova
    const old = new Date("2026-01-01T12:00:00Z");
    await Subscriber.updateOne({ _id: sub._id }, { memberSince: old });
    const again = await admin.patch(`/api/subscribers/${sub._id}`).send({ tier: "member" });
    expect(new Date(again.body.memberSince).getTime()).toBeGreaterThan(old.getTime());
  });

  it("cadastro manual como membro já traz 'membro desde'; plano inválido: 422", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/subscribers/manual").send({ email: "membro@teste.dev", tier: "member" });
    expect(res.status).toBe(201);
    expect(res.body.memberSince).toBeTruthy();
    expect(res.body.token).toBeUndefined();
    expect((await admin.patch(`/api/subscribers/${res.body._id}`).send({ tier: "vip" })).status).toBe(422);
  });

  it("o painel nunca recebe o token de cancelamento", async () => {
    const admin = await asAdmin();
    await Subscriber.create({ email: "t@teste.dev" });
    const list = await admin.get("/api/subscribers");
    expect(list.body.subscribers).toHaveLength(1);
    expect(list.body.subscribers[0].token).toBeUndefined();
  });
});

describe("exportação CSV (R-SUB-08)", () => {
  it("separador ';', BOM UTF-8, e células com = + - @ viram texto", async () => {
    const admin = await asAdmin();
    await Subscriber.create({ email: "csv@teste.dev", name: '=HYPERLINK("http://x")', notes: "+55 11", categories: ["design", "carreira"] });
    await Subscriber.create({ email: "arroba@teste.dev", name: "@fulano", notes: "-1" });

    const res = await admin.get("/api/subscribers/export.csv").buffer(true).parse(asText);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="assinantes-\d{4}-\d{2}-\d{2}\.csv"/);
    const csv = res.body;
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, ...rows] = csv.slice(1).split("\r\n");
    expect(header.split(";")[0]).toBe('"email"');
    expect(header.split(";")).toHaveLength(14);
    const csvRow = rows.find((r) => r.includes("csv@teste.dev"));
    // Fórmula vira texto (apóstrofo) e as aspas internas são duplicadas
    expect(csvRow).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csvRow).toContain(`"'+55 11"`);
    expect(csvRow).toContain('"design, carreira"');
    const atRow = rows.find((r) => r.includes("arroba@teste.dev"));
    expect(atRow).toContain(`"'@fulano"`);
    expect(atRow).toContain(`"'-1"`);
  });

  it("usa os mesmos filtros da lista e exige login", async () => {
    const admin = await asAdmin();
    await Subscriber.create({ email: "ativo@teste.dev" });
    await Subscriber.create({ email: "saiu@teste.dev", status: "unsubscribed" });

    const res = await admin.get("/api/subscribers/export.csv?status=unsubscribed").buffer(true).parse(asText);
    expect(res.body).toContain("saiu@teste.dev");
    expect(res.body).not.toContain("ativo@teste.dev");

    expect((await api().get("/api/subscribers/export.csv")).status).toBe(401);
  });
});
