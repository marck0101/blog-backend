import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { pacing, daysInMonth } = require("../../app/services/cockpitPacing.service");

const run = (accumulated, meta, day, dim) => pacing({ accumulated, meta, day, daysInMonth: dim });

describe("ritmo da receita (R-COCKPIT-01)", () => {
  it("dias do mês: fevereiro comum, bissexto, 30 e 31", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("meio do mês: esperado, projeção e status", () => {
    const r = run(7500, 15000, 15, 30);
    expect(r.expected).toBe(7500);
    expect(r.projection).toBe(15000);
    expect(r.pctOfExpected).toBe(100);
    expect(r.status).toBe("no_caminho");
  });

  it("dia 1: esperado é meta/dias e a projeção multiplica o dia", () => {
    const r = run(1000, 15000, 1, 30);
    expect(r.expected).toBe(500);
    expect(r.projection).toBe(30000);
    expect(r.status).toBe("no_caminho");
  });

  it("dia 31: esperado é a meta inteira", () => {
    const r = run(14000, 15000, 31, 31);
    expect(r.expected).toBe(15000);
    expect(r.projection).toBe(14000);
    expect(r.pctOfExpected).toBe(93.3);
    expect(r.status).toBe("atencao");
  });

  it("fevereiro (28 e 29 dias)", () => {
    expect(run(7000, 14000, 14, 28).expected).toBe(7000);
    expect(run(7000, 14000, 14, 29).expected).toBeCloseTo(6758.62, 2);
  });

  it("faixas: 100% no caminho, 85% atenção, abaixo de 85% fora", () => {
    expect(run(1000, 3000, 10, 30).status).toBe("no_caminho"); // 100%
    expect(run(850, 3000, 10, 30).status).toBe("atencao"); // 85%
    expect(run(849, 3000, 10, 30).status).toBe("fora");
    expect(run(999, 3000, 10, 30).status).toBe("atencao");
  });

  it("meta zero ou ausente: sem dados, sem divisão por zero", () => {
    const r = run(500, 0, 10, 30);
    expect(r.status).toBe("sem_dados");
    expect(r.expected).toBeNull();
    expect(r.pctOfExpected).toBeNull();
    expect(r.projection).toBe(1500);
    expect(run(500, null, 10, 30).status).toBe("sem_dados");
  });

  it("sem acumulado: sem dados", () => {
    const r = run(null, 15000, 10, 30);
    expect(r.status).toBe("sem_dados");
    expect(r.projection).toBeNull();
  });

  it("acumulado zero com meta: fora do ritmo", () => {
    expect(run(0, 15000, 10, 30).status).toBe("fora");
  });

  it("dia fora do mês: sem dados", () => {
    expect(run(100, 15000, 0, 30).status).toBe("sem_dados");
    expect(run(100, 15000, 31, 30).status).toBe("sem_dados");
  });
});
