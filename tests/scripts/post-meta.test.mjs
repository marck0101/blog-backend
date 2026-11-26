import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { seoFields } = require("../../scripts/post-meta");

describe("seoFields (import-draft / import-season)", () => {
  it("só repassa o que está no arquivo (um --update não apaga o painel)", () => {
    expect(seoFields({ title: "x" })).toEqual({});
  });

  it("repassa tema, pilar, tags, resposta direta e FAQ", () => {
    const faq = [{ question: "P?", answer: "R." }];
    expect(
      seoFields({ cluster: "trafego-pago-medido", isPillar: true, tags: ["google ads"], directAnswer: "Resposta.", faq })
    ).toEqual({ cluster: "trafego-pago-medido", isPillar: true, tags: ["google ads"], directAnswer: "Resposta.", faq });
  });

  it("tema vazio vira null e tira o pilar", () => {
    expect(seoFields({ cluster: "", isPillar: true })).toEqual({ cluster: null, isPillar: false });
  });

  it("recusa tema inexistente e pilar sem tema", () => {
    expect(() => seoFields({ cluster: "nao-existe" }, "01.html")).toThrow(/01.html: tema "nao-existe"/);
    expect(() => seoFields({ isPillar: true })).toThrow(/escolha o tema/);
  });

  it("recusa resposta direta acima do limite do banco", () => {
    expect(() => seoFields({ directAnswer: "a".repeat(401) })).toThrow(/400/);
  });
});
