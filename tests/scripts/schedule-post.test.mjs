import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { plannedDate, MARKERS } = require("../../scripts/schedule-post");

describe("schedule-post", () => {
  it("agenda para 08:50 de Brasília, antes da rotina das 9h (12:00 UTC)", () => {
    expect(plannedDate("2026-11-30").toISOString()).toBe("2026-11-30T11:50:00.000Z");
  });

  it("recusa data fora do formato", () => {
    expect(() => plannedDate("30/11/2026")).toThrow();
    expect(() => plannedDate()).toThrow();
  });

  it("reconhece os avisos internos que não podem ir ao ar", () => {
    expect(MARKERS.test("<p>[A COMPLETAR: print 1]</p>")).toBe(true);
    expect(MARKERS.test("<p>[INTERNO — REMOVER]</p>")).toBe(true);
    expect(MARKERS.test("<p>[<em>s. l.</em>]</p>")).toBe(false);
  });
});
