import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { loadPublished, diff } = require("../../scripts/update-published");

const dirs = [];
function folder(meta, html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "post.json"), JSON.stringify(meta));
  if (html !== undefined) fs.writeFileSync(path.join(dir, "content.html"), html);
  return dir;
}
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("update-published: leitura das pastas", () => {
  it("ignora pasta que não é de post publicado (rascunho, sem status)", () => {
    expect(loadPublished(folder({ slug: "x", title: "Rascunho" }, "<p>texto</p>"))).toBeNull();
  });

  it("leva só conteúdo limpo e campos de SEO; título, resumo e datas nunca", () => {
    const { slug, set } = loadPublished(
      folder(
        { slug: "post-a", status: "published", title: "Novo título", excerpt: "x", plannedAt: "2026-01-01", cluster: "dashboards-e-bi", tags: ["Core Web Vitals"] },
        '<p>Oi <a href="/blog/b" onclick="x()">b</a></p><script>alert(1)</script>'
      )
    );
    expect(slug).toBe("post-a");
    expect(Object.keys(set).sort()).toEqual(["cluster", "content", "isPillar", "tags"]);
    expect(set.tags).toEqual(["core-web-vitals"]);
    expect(set.content).not.toMatch(/script|onclick/);
    expect(set.content).toContain('href="/blog/b"');
  });

  it("recusa conteúdo com trecho a completar ou nota de rascunho", () => {
    const meta = { slug: "p", status: "published" };
    expect(() => loadPublished(folder(meta, "<p>[A COMPLETAR: ferramenta]</p>"))).toThrow(/proibido/);
    expect(() => loadPublished(folder(meta, "<p>[RASCUNHO — nota]</p>"))).toThrow(/proibido/);
  });

  it("recusa tema inexistente", () => {
    expect(() => loadPublished(folder({ slug: "p", status: "published", cluster: "nao-existe" }))).toThrow(/não existe/);
  });
});

describe("update-published: o que muda", () => {
  it("só lista campos diferentes, com resumo de conteúdo e links", () => {
    const post = { content: "<p>a</p>", cluster: "dashboards-e-bi", tags: ["a"], faq: [] };
    const { changes, lines } = diff(post, { content: '<p>a <a href="/x">x</a></p>', cluster: "dashboards-e-bi", tags: ["a", "b"] });
    expect(Object.keys(changes)).toEqual(["content", "tags"]);
    expect(lines[0]).toMatch(/links 0 → 1/);
  });

  it("nada diferente: nada a fazer", () => {
    expect(diff({ cluster: null, tags: [] }, { cluster: null, tags: [] }).lines).toEqual([]);
  });
});
