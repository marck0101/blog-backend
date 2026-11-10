import { describe, expect, it } from "vitest";
import { asAdmin, createPost, models } from "../helpers.mjs";

const { BlogPost, Campaign, Comment, PostDailyStat, PostRevision } = models;

// R-TRASH-01..03 e SEC-04: lixeira e exclusão definitiva
describe("lixeira", () => {
  it("excluir manda para a lixeira e desafixa da vitrine", async () => {
    const admin = await asAdmin();
    const post = await createPost({ pinnedOrder: 1 });
    const res = await admin.delete(`/api/posts/${post._id}`);
    expect(res.status).toBe(200);
    const saved = await BlogPost.findById(post._id).lean();
    expect(saved.deletedAt).not.toBeNull();
    expect(saved.pinnedOrder).toBeNull();
  });

  it("restaurar agendado com data vencida vira rascunho", async () => {
    const admin = await asAdmin();
    const post = await createPost({ status: "planned", plannedAt: new Date(Date.now() - 86400000), deletedAt: new Date() });
    await admin.patch(`/api/posts/${post._id}/restore`);
    const saved = await BlogPost.findById(post._id).lean();
    expect(saved.deletedAt).toBeNull();
    expect(saved.status).toBe("draft");
  });

  it("restaurar agendado com data futura continua agendado", async () => {
    const admin = await asAdmin();
    const post = await createPost({ status: "planned", plannedAt: new Date(Date.now() + 86400000), deletedAt: new Date() });
    await admin.patch(`/api/posts/${post._id}/restore`);
    expect((await BlogPost.findById(post._id).lean()).status).toBe("planned");
  });
});

describe("exclusão definitiva", () => {
  it("post fora da lixeira não pode ser excluído de vez (409)", async () => {
    const admin = await asAdmin();
    const post = await createPost({ status: "published", published: true });
    const res = await admin.delete(`/api/posts/${post._id}/hard`);
    expect(res.status).toBe(409);
    expect(await BlogPost.exists({ _id: post._id })).toBeTruthy();
  });

  it("post inexistente: 404", async () => {
    const admin = await asAdmin();
    const res = await admin.delete("/api/posts/64b000000000000000000000/hard");
    expect(res.status).toBe(404);
  });

  it("apaga o post e o que é dele, sem deixar órfãos; envios ficam sem o vínculo", async () => {
    const admin = await asAdmin();
    const post = await createPost({ deletedAt: new Date() });
    const other = await createPost({ title: "Outro post" });

    await PostRevision.create({ post: post._id, version: 1, snapshot: {}, hash: "x" });
    await Comment.create({ post: post._id, author: { name: "Leitor" }, body: "Oi" });
    await Comment.create({ post: other._id, author: { name: "Leitor" }, body: "Oi" });
    await PostDailyStat.create({ post: post._id, day: "2026-11-01", views: 3 });
    const campaign = await Campaign.create({ subject: "Aviso", kind: "post-notification", post: post._id });

    const res = await admin.delete(`/api/posts/${post._id}/hard`);
    expect(res.status).toBe(200);

    expect(await BlogPost.exists({ _id: post._id })).toBeNull();
    expect(await PostRevision.countDocuments({ post: post._id })).toBe(0);
    expect(await Comment.countDocuments({ post: post._id })).toBe(0);
    expect(await PostDailyStat.countDocuments({ post: post._id })).toBe(0);
    // Do outro post, nada muda
    expect(await Comment.countDocuments({ post: other._id })).toBe(1);
    // Envio continua (histórico), sem apontar para o post apagado
    const kept = await Campaign.findById(campaign._id).lean();
    expect(kept).not.toBeNull();
    expect(kept.post).toBeNull();
  });
});
