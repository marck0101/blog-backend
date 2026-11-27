import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { api, asAdmin } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const Experiment = require("../../app/models/experiment.model");

const future = () => new Date(Date.now() + 7 * 86400000).toISOString();
const sorteio = (over = {}) => ({
  chave: "cta-diagnostico",
  alvo: "pre-diagnostico-cta",
  variantes: [
    { chave: "controle", texto: "Fazer o pré-diagnóstico" },
    { chave: "curto", texto: "Descobrir meu cenário" },
  ],
  ...over,
});
const base = (over = {}) => ({
  title: "Texto do botão do pré-diagnóstico",
  hypothesis: "Se o botão falar do resultado, então o clique sobe, porque deixa claro o ganho",
  area: "site",
  ice: { impact: 4, confidence: 3, ease: 5 },
  metric: "Cliques no CTA",
  plannedEnd: future(),
  variants: [{ name: "A" }, { name: "B" }],
  ...over,
});
const create = async (admin, body) => (await admin.post("/api/cockpit/experiments").send(body)).body.experiment;
const go = (admin, id, status) => admin.post(`/api/cockpit/experiments/${id}/transition`).send({ status });
const roda = async (admin, body) => {
  const e = await create(admin, body);
  await go(admin, e._id, "planejado");
  expect((await go(admin, e._id, "rodando")).status).toBe(200);
  return e;
};
const docBase = { hypothesis: "Se a, então b, porque c", area: "site", ice: { impact: 1, confidence: 1, ease: 1 } };
const duas = [
  { chave: "a", texto: "A" },
  { chave: "b", texto: "B" },
];

describe("experimentos: variantes para o site (validação)", () => {
  it("cria com chave, alvo e 2 a 4 variantes", async () => {
    const admin = await asAdmin();
    const res = await admin.post("/api/cockpit/experiments").send(base(sorteio()));
    expect(res.status).toBe(201);
    expect(res.body.experiment.alvo).toBe("pre-diagnostico-cta");
    expect(res.body.experiment.variantes).toHaveLength(2);
  });

  it("recusa alvo desconhecido, 1 ou 5 variantes, slug inválido, texto longo e chaves repetidas", async () => {
    const admin = await asAdmin();
    const v = (n) => Array.from({ length: n }, (_, i) => ({ chave: `v${i}`, texto: "Texto" }));
    const bad = [
      sorteio({ alvo: "rodape" }),
      sorteio({ variantes: v(1) }),
      sorteio({ variantes: v(5) }),
      sorteio({ chave: "Chave Ruim" }),
      sorteio({ variantes: [{ chave: "a b", texto: "x" }, { chave: "b", texto: "y" }] }),
      sorteio({ variantes: [{ chave: "a", texto: "x".repeat(201) }, { chave: "b", texto: "y" }] }),
      sorteio({ variantes: [{ chave: "a", texto: "x" }, { chave: "a", texto: "y" }] }),
      sorteio({ variantes: [{ chave: "a", texto: "" }, { chave: "b", texto: "y" }] }),
    ];
    for (const body of bad) {
      expect((await admin.post("/api/cockpit/experiments").send(base(body))).status, JSON.stringify(body)).toBe(422);
    }
    expect(await Experiment.countDocuments({})).toBe(0);
  });

  it("chave, alvo e variantes andam juntos (criar e editar)", async () => {
    const admin = await asAdmin();
    expect((await admin.post("/api/cockpit/experiments").send(base({ alvo: "pre-diagnostico-cta" }))).status).toBe(422);
    expect((await admin.post("/api/cockpit/experiments").send(base({ chave: "so-chave" }))).status).toBe(422);
    const e = await create(admin, base());
    expect((await admin.put(`/api/cockpit/experiments/${e._id}`).send({ alvo: "pre-diagnostico-cta" })).status).toBe(422);
    expect((await admin.put(`/api/cockpit/experiments/${e._id}`).send(sorteio())).status).toBe(200);
    // limpar tudo de uma vez é permitido
    expect((await admin.put(`/api/cockpit/experiments/${e._id}`).send({ chave: null, alvo: null, variantes: [] })).status).toBe(200);
  });

  it("chave repetida: 409", async () => {
    const admin = await asAdmin();
    await create(admin, base(sorteio()));
    expect((await admin.post("/api/cockpit/experiments").send(base(sorteio()))).status).toBe(409);
  });

  it("dois experimentos rodando no mesmo espaço do site: o segundo não roda", async () => {
    const admin = await asAdmin();
    await roda(admin, base(sorteio()));
    const b = await create(admin, base(sorteio({ chave: "outra-chave" })));
    await go(admin, b._id, "planejado");
    const r = await go(admin, b._id, "rodando");
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toMatch(/rodando nesse espaço/);
  });
});

describe("GET /api/experiments/ativos (público)", () => {
  it("sem experimento: lista vazia, sem login, com cache curto", async () => {
    const res = await api().get("/api/experiments/ativos");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(res.headers["cache-control"]).toMatch(/public, max-age=60/);
  });

  it("lista só os rodando com alvo e variantes", async () => {
    const admin = await asAdmin();
    await roda(admin, base(sorteio()));
    await create(admin, base(sorteio({ chave: "so-ideia" }))); // fica em "ideia"
    const semAlvo = await create(admin, base({ title: "Experimento fora do site", variants: [{ name: "A" }, { name: "B" }] }));
    await go(admin, semAlvo._id, "planejado");
    expect((await go(admin, semAlvo._id, "rodando")).status).toBe(200);

    const res = await api().get("/api/experiments/ativos");
    expect(res.status).toBe(200);
    expect(res.body.map((e) => e.chave)).toEqual(["cta-diagnostico"]);
  });

  it("experimento concluído ou na lixeira não aparece", async () => {
    await Experiment.create({ ...docBase, title: "Na lixeira", status: "rodando", chave: "lixeira", alvo: "pre-diagnostico-cta", deletedAt: new Date(), variantes: duas });
    await Experiment.create({ ...docBase, title: "Concluído", status: "concluido", chave: "concluido", alvo: "pre-diagnostico-cta", variantes: duas });
    expect((await api().get("/api/experiments/ativos")).body).toEqual([]);
  });

  it("devolve só chave, alvo e variantes (sem hipótese, métrica, notas, id nem datas)", async () => {
    const admin = await asAdmin();
    await roda(admin, base({ ...sorteio(), channel: "Canal interno", guardrailMetric: "Envios do formulário", result: { learning: "nota interna" } }));
    const res = await api().get("/api/experiments/ativos");
    expect(res.body).toEqual([
      {
        chave: "cta-diagnostico",
        alvo: "pre-diagnostico-cta",
        variantes: [
          { chave: "controle", texto: "Fazer o pré-diagnóstico" },
          { chave: "curto", texto: "Descobrir meu cenário" },
        ],
      },
    ]);
    const txt = JSON.stringify(res.body);
    for (const proibido of ["hypothesis", "metric", "ice", "_id", "result", "nota interna", "Canal interno", "createdAt", "startedAt", "title"]) {
      expect(txt).not.toContain(proibido);
    }
  });
});
