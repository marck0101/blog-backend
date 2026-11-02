import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { dayKey, parseDayKey, startOfDay, endOfDay, addDays, monthRange, yearRange, dayRangeFilter } = require("../../app/utils/dates");

// DUP-06: contas de dia/mês/ano no fuso de Brasília, com o servidor em UTC.
// "22h de 31/10 em Brasília" = 01:00 de 01/11 em UTC: o caso que dava errado.
const LATE_NIGHT_BR = new Date("2026-11-01T01:00:00Z");

describe("dayKey", () => {
  it("22h de Brasília ainda é o mesmo dia (em UTC já seria amanhã)", () => {
    expect(dayKey(LATE_NIGHT_BR)).toBe("2026-10-31");
  });
});

describe("parseDayKey", () => {
  it.each([["2026-02-28", "2026-02-28"], ["2028-02-29", "2028-02-29"]])("%s é válido", (value, expected) => {
    expect(parseDayKey(value)).toBe(expected);
  });
  it.each(["2026-02-30", "2026-13-01", "26-1-1", "", undefined, { $ne: null }, "2026-11-01T00:00"])("%j é inválido", (value) => {
    expect(parseDayKey(value)).toBeNull();
  });
});

describe("início e fim do dia", () => {
  it("dia começa às 00:00 de Brasília (03:00 UTC) e termina às 23:59:59.999", () => {
    expect(startOfDay("2026-11-15").toISOString()).toBe("2026-11-15T03:00:00.000Z");
    expect(endOfDay("2026-11-15").toISOString()).toBe("2026-11-16T02:59:59.999Z");
  });

  it("addDays atravessa mês e ano", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("monthRange", () => {
  it("às 22h do último dia do mês, 'este mês' ainda é o mês que está acabando", () => {
    const { start, end } = monthRange(LATE_NIGHT_BR);
    expect(start.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-01T02:59:59.999Z");
  });

  it("mês anterior, inclusive virando o ano", () => {
    const { start, end } = monthRange(new Date("2026-01-15T12:00:00Z"), -1);
    expect(start.toISOString()).toBe("2025-12-01T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-01T02:59:59.999Z");
  });
});

describe("yearRange", () => {
  it("ano em Brasília", () => {
    const { start, end } = yearRange(2026);
    expect(start.toISOString()).toBe("2026-01-01T03:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T02:59:59.999Z");
  });
});

describe("dayRangeFilter (filtros 'de / até' das listas)", () => {
  it("dias inteiros em Brasília", () => {
    const f = dayRangeFilter("2026-11-01", "2026-11-30");
    expect(f.$gte.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(f.$lte.toISOString()).toBe("2026-12-01T02:59:59.999Z");
  });

  it("só um dos lados", () => {
    expect(Object.keys(dayRangeFilter("2026-11-01", ""))).toEqual(["$gte"]);
    expect(Object.keys(dayRangeFilter(undefined, "2026-11-30"))).toEqual(["$lte"]);
  });

  it("valor inválido é ignorado, não vira erro nem operador", () => {
    expect(dayRangeFilter("ontem", { $gt: "" })).toBeNull();
  });
});
