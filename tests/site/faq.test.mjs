import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { api } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const { BLOG_FAQ, SEASONS_FAQ } = require("../../app/config/siteFaq");

// Hash do conteúdo do FAQ. O MESMO valor está em src/seo/site.test.js do front (blog-front):
// mudou o texto, atualize a reserva do front e este hash nos dois repositórios.
export const FAQ_HASH = "d0691d37ae41d34cac632e82a1442637cab7ab6b05d1f388aeefe462a332d1d5";
const hashOf = (blog, seasons) => createHash("sha256").update(JSON.stringify({ blog, seasons })).digest("hex");

describe("GET /api/site/faq (OPS-01: fonte única do FAQ)", () => {
  it("é público e devolve o FAQ da home e de /seasons, igual ao config", async () => {
    const res = await api().get("/api/site/faq");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ blog: BLOG_FAQ, seasons: SEASONS_FAQ });
  });

  it("tem cache de CDN e stale-while-revalidate", async () => {
    const res = await api().get("/api/site/faq");
    expect(res.headers["cache-control"]).toBe("public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  });

  it("todo par tem pergunta e resposta preenchidas", () => {
    for (const item of [...BLOG_FAQ, ...SEASONS_FAQ]) {
      expect(item.question.trim().length).toBeGreaterThan(0);
      expect(item.answer.trim().length).toBeGreaterThan(0);
    }
  });

  it("copy: sem pequeno/grande/PME (usar 'negócios locais')", () => {
    const text = JSON.stringify([...BLOG_FAQ, ...SEASONS_FAQ]);
    expect(text).not.toMatch(/\b(pequen[oa]s?|grandes?|PMEs?)\b/i);
  });

  it("contrato com o front: hash do conteúdo bate com o pinado", () => {
    expect(hashOf(BLOG_FAQ, SEASONS_FAQ)).toBe(FAQ_HASH);
  });
});
