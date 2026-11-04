import { describe, expect, it } from "vitest";
import { PANEL_ORIGIN, api, createPost, models } from "../helpers.mjs";

const { BlogPost, PostDailyStat } = models;

// BIZ-02 / R-ENG-03: leitura contada pelo navegador do leitor (evento "view")
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const view = (postId, userAgent = BROWSER_UA) =>
  api()
    .post(`/api/posts/public/${postId}/engage`)
    .set("Origin", PANEL_ORIGIN)
    .set("User-Agent", userAgent)
    .send({ type: "view" });

const published = () => createPost({ status: "published", published: true, publishedAt: new Date() });

describe("leitura de post", () => {
  it("navegador de leitor: conta no total e no dia, sem mudar o updatedAt", async () => {
    const post = await published();
    const before = (await BlogPost.findById(post._id).lean()).updatedAt;

    expect((await view(post._id)).status).toBe(204);

    const after = await BlogPost.findById(post._id).lean();
    expect(after.views).toBe(1);
    expect(after.updatedAt).toEqual(before);
    expect((await PostDailyStat.findOne({ post: post._id }).lean()).views).toBe(1);
  });

  it.each([
    ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["Lighthouse / PageSpeed", "Mozilla/5.0 (Linux; Android 11) Chrome-Lighthouse"],
    ["pré-visualização do LinkedIn", "LinkedInBot/1.0 (compatible; Mozilla/5.0)"],
    ["navegador sem interface", "Mozilla/5.0 HeadlessChrome/130.0"],
    ["sem user-agent", ""],
  ])("%s não conta", async (_, ua) => {
    const post = await published();
    expect((await view(post._id, ua)).status).toBe(204);
    expect((await BlogPost.findById(post._id).lean()).views).toBe(0);
    expect(await PostDailyStat.countDocuments({ post: post._id })).toBe(0);
  });

  it("rascunho não recebe leitura (404)", async () => {
    const draft = await createPost();
    expect((await view(draft._id)).status).toBe(404);
  });

  it("de fora do site (outra origem) é recusado", async () => {
    const post = await published();
    const res = await api()
      .post(`/api/posts/public/${post._id}/engage`)
      .set("Origin", "https://evil.example")
      .set("User-Agent", BROWSER_UA)
      .send({ type: "view" });
    expect(res.status).toBe(403);
  });
});
