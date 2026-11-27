import { createRequire } from "node:module";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildCoverSvg, renderCoverPng, layoutTitle, formatDate, THEMES } = require("../../app/services/coverCard.service");

const LONG =
  "Conferência de Tag Manager antes de confiar nos números: o que eu checo em cada conta antes de ligar o primeiro real em tráfego pago e depois também";

describe("capa automática: título", () => {
  it("título curto fica em uma linha, no maior tamanho", () => {
    const { size, lines } = layoutTitle("Tag Manager sem achismo");
    expect(lines).toEqual(["Tag Manager sem achismo"]);
    expect(size).toBe(72);
  });

  it("título longo quebra em no máximo 3 linhas e termina com reticências", () => {
    const { lines } = layoutTitle(LONG.repeat(2));
    expect(lines).toHaveLength(3);
    expect(lines[2].endsWith("…")).toBe(true);
  });

  it("título que cabe em 3 linhas não leva reticências", () => {
    const { lines } = layoutTitle("Quanto custa um site que vende e por que o orçamento barato sai caro no fim das contas");
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join(" ").includes("…")).toBe(false);
  });

  it("palavra gigante não estoura a largura", () => {
    const { lines } = layoutTitle("a".repeat(200));
    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith("…")).toBe(true);
  });

  it("vazio ou só emoji usa o título de reserva", () => {
    expect(layoutTitle("").lines).toEqual(["Sem título"]);
    expect(layoutTitle("🚀🔥").lines).toEqual(["Sem título"]);
  });

  it("mantém acentos e remove emoji do meio do texto", () => {
    expect(layoutTitle("Ação, atenção e coração 🚀 já").lines.join(" ")).toBe("Ação, atenção e coração já");
  });
});

describe("capa automática: SVG", () => {
  const base = { title: "Teste", category: "Tráfego", date: "2026-11-27T15:00:00Z" };

  it("não tem <text> nem texto do usuário: só caminhos (sem injeção)", () => {
    const svg = buildCoverSvg({ ...base, title: `</svg><script>alert(1)</script> & "x" <b>`, label: "<img src=x>" });
    expect(svg).not.toMatch(/<text|<script|<img|<b>/);
    expect(svg.match(/<svg/g)).toHaveLength(1);
  });

  it("usa os tokens da marca, sem degradê", () => {
    const claro = buildCoverSvg({ ...base, theme: "claro" });
    const escuro = buildCoverSvg({ ...base, theme: "escuro" });
    expect(claro).toContain(`fill="${THEMES.claro.bg}"`);
    expect(escuro).toContain(`fill="${THEMES.escuro.bg}"`);
    expect(claro).toContain("#D9542B");
    expect(escuro).toContain("#D9542B");
    expect(claro + escuro).not.toMatch(/gradient/i);
  });

  it("tema desconhecido cai no claro", () => {
    expect(buildCoverSvg({ ...base, theme: "neon" })).toBe(buildCoverSvg({ ...base, theme: "claro" }));
  });

  it("não escreve 'fig.' nem número inventado", () => {
    expect(buildCoverSvg(base)).not.toMatch(/fig\./i);
  });
});

describe("capa automática: data e PNG", () => {
  it("formata no fuso de Brasília (23h de 31/12 em SP já é 01/01 em UTC)", () => {
    expect(formatDate("2027-01-01T01:30:00Z")).toBe("31 DEZ 2026");
    expect(formatDate("2026-11-27T15:00:00Z")).toBe("27 NOV 2026");
    expect(formatDate("lixo")).toBe("");
    expect(formatDate(undefined)).toBe("");
  });

  it("gera PNG 1200x630 para os dois temas", async () => {
    for (const theme of ["claro", "escuro"]) {
      const png = await renderCoverPng({ title: LONG, category: "Tráfego", date: new Date(), theme });
      const meta = await sharp(png).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["png", 1200, 630]);
    }
  });

  it("categoria muito longa não quebra o rótulo", async () => {
    const png = await renderCoverPng({ title: "x", label: "Categoria ".repeat(30), date: new Date() });
    expect((await sharp(png).metadata()).width).toBe(1200);
  });
});
