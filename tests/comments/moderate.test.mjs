import { describe, expect, it } from "vitest";
import { asAdmin, createPost, models } from "../helpers.mjs";

const { Comment } = models;

// Recusa com motivo (vinda da main) passando pelo esquema da rota (VAL-01)
describe("moderar comentário", () => {
  it("recusa com motivo guarda o motivo em uma linha", async () => {
    const admin = await asAdmin();
    const post = await createPost();
    const c = await Comment.create({ post: post._id, author: { name: "Leitor" }, body: "Oi" });

    const res = await admin.patch(`/api/comments/admin/${c._id}`).send({ status: "rejected", reason: "Fora do\ntema", notify: false });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(res.body.rejectionReason).toBe("Fora do tema");
    expect(res.body.notified).toBe(false);
  });

  it("motivo acima de 500 caracteres é recusado", async () => {
    const admin = await asAdmin();
    const post = await createPost();
    const c = await Comment.create({ post: post._id, author: { name: "Leitor" }, body: "Oi" });

    const res = await admin.patch(`/api/comments/admin/${c._id}`).send({ status: "rejected", reason: "x".repeat(501), notify: false });
    expect(res.status).toBe(422);
  });

  it("lista aceita ?sort=oldest", async () => {
    const admin = await asAdmin();
    const res = await admin.get("/api/comments/admin?status=pending&sort=oldest");
    expect(res.status).toBe(200);
  });
});
