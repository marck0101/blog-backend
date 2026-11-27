import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { plannedDate, linkProblems, MARKERS } =require("../../scripts/schedule-post");

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

  it("aponta links internos que dariam 404 na data da publicação", () => {
    const when = plannedDate("2026-12-14");
    const targets = {
      publicado: { status: "published" },
      antes: { status: "planned", plannedAt: plannedDate("2026-12-07") },
      depois: { status: "planned", plannedAt: plannedDate("2026-12-21") },
      rascunho: { status: "draft" },
    };
    const html = ["publicado", "antes", "depois", "rascunho", "sumiu", "depois"]
      .map((s) => `<a href="/blog/${s}">x</a>`)
      .join("");
    expect(linkProblems(html, targets, when)).toEqual(["depois (planned 2026-12-21)", "rascunho (draft)", "sumiu (não existe)"]);
    expect(linkProblems('<a href="/blog/publicado">x</a>', targets, when)).toEqual([]);
  });
});
