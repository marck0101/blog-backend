import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { asAdmin, createPost, models } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const { sanitizeHtml, looksDangerous } = require("../../app/utils/sanitizeHtml");

// SEC-01: o HTML dos posts e envios é limpo ao salvar
describe("sanitizeHtml", () => {
  it.each([
    ["script", '<p>a</p><script>alert(1)</script>'],
    ["evento onerror", '<img src="https://x/a.webp" onerror="alert(1)">'],
    ["javascript: no link", '<a href="javascript:alert(1)">clique</a>'],
    ["iframe", '<iframe src="https://evil.example"></iframe>'],
    ["formulário", '<form action="https://evil.example"><input name="senha"></form>'],
    ["style com url()", '<p style="background:url(https://evil.example/x)">a</p>'],
    ["imagem data:", '<img src="data:text/html;base64,PHNjcmlwdD4=">'],
  ])("remove %s", (_, html) => {
    expect(looksDangerous(sanitizeHtml(html))).toBe(false);
    expect(sanitizeHtml(html)).not.toMatch(/alert|evil\.example|onerror|<input/);
  });

  it("mantém a formatação do editor", () => {
    const html =
      '<h2>Título</h2><p style="text-align: center"><strong>negrito</strong> <em>itálico</em> <u>sub</u> <s>riscado</s></p>' +
      '<ul><li><p>item</p></li></ul><ol start="3"><li>três</li></ol><blockquote><p>citação</p></blockquote><hr>' +
      '<pre><code class="language-js">const a = 1;</code></pre>' +
      '<p><a href="https://site.com" target="_blank" rel="noopener noreferrer nofollow">link</a></p>' +
      '<img src="https://storage.googleapis.com/b/covers/1.webp" alt="Capa" width="1200" height="630" style="width: 50%; height: auto; display: block;">';
    const clean = sanitizeHtml(html);
    for (const piece of [
      "<h2>Título</h2>", 'style="text-align:center"', "<strong>negrito</strong>", "<u>sub</u>", "<s>riscado</s>",
      '<ol start="3">', "<blockquote>", "<hr />", 'class="language-js"', 'href="https://site.com"', 'target="_blank"',
      'alt="Capa"', 'width="1200"', 'height="630"', "width:50%",
    ]) {
      expect(clean).toContain(piece);
    }
  });

  it("link que abre em outra aba ganha noopener", () => {
    expect(sanitizeHtml('<a href="https://x.com" target="_blank">x</a>')).toContain('rel="noopener noreferrer"');
  });

  it("é estável: limpar duas vezes dá o mesmo resultado", () => {
    const once = sanitizeHtml('<p style="text-align: right">a<br>b</p><img src="https://x/a.webp" alt="">');
    expect(sanitizeHtml(once)).toBe(once);
  });

  it("conteúdo dos imports (content/) não perde nada perigoso nem formatação", () => {
    const dir = new URL("../../content/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
    const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".html"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const html = readFileSync(join(dir, String(file)), "utf8");
      const tags = (s) => (s.match(/<[a-z][a-z0-9]*/gi) || []).length;
      expect(tags(sanitizeHtml(html)), String(file)).toBe(tags(html));
    }
  });

  it("não-texto vira vazio", () => {
    expect(sanitizeHtml({ $ne: null })).toBe("");
  });
});

describe("rotas limpam o HTML ao salvar", () => {
  const evil = '<p>ok</p><script>alert(1)</script><img src="https://x/a.webp" onerror="alert(1)">';

  it("criar e editar post", async () => {
    const admin = await asAdmin();
    const created = await admin.post("/api/posts").send({ title: "Post", category: "design", content: evil });
    expect(created.status).toBe(201);
    expect(looksDangerous(created.body.content)).toBe(false);

    const updated = await admin.put(`/api/posts/${created.body._id}`).send({ content: evil });
    expect(looksDangerous(updated.body.content)).toBe(false);
    expect(updated.body.content).toContain("<p>ok</p>");
  });

  it("restaurar versão antiga com conteúdo perigoso também limpa", async () => {
    const admin = await asAdmin();
    const post = await createPost();
    await models.PostRevision.create({
      post: post._id,
      version: 1,
      snapshot: { title: "Velho", slug: post.slug, content: evil, category: "tecnologia" },
      hash: "velho",
    });
    const res = await admin.post(`/api/posts/${post._id}/revisions/1/restore`);
    expect(res.status).toBe(200);
    expect(looksDangerous(res.body.content)).toBe(false);
  });

  it("criar e editar envio", async () => {
    const admin = await asAdmin();
    const created = await admin.post("/api/campaigns").send({ subject: "Oi", content: evil });
    expect(looksDangerous(created.body.content)).toBe(false);
    const updated = await admin.patch(`/api/campaigns/${created.body._id}`).send({ content: evil });
    expect(looksDangerous(updated.body.content)).toBe(false);
  });
});
