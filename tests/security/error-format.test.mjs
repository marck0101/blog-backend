import { describe, expect, it } from "vitest";
import { PANEL_ORIGIN, api, asAdmin, createAdmin, sessionCookie } from "../helpers.mjs";

// DUP-01: todo erro da API traz { error: "texto" }. O front lê só isso.
const hasError = (res) => {
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(typeof res.body.error).toBe("string");
  expect(res.body.error.length).toBeGreaterThan(0);
};

describe("formato único de erro", () => {
  it("sessão ausente, inválida e de versão antiga (middleware)", async () => {
    hasError(await api().get("/api/posts"));
    hasError(await api().get("/api/posts").set("Cookie", "admin_session=lixo"));
    const user = await createAdmin({ sessionVersion: 2 });
    hasError(await api().get("/api/posts").set("Cookie", sessionCookie(user, { v: 1 })));
  });

  it("CSRF (origem não permitida)", async () => {
    const user = await createAdmin();
    hasError(await api().post("/api/posts").set("Cookie", sessionCookie(user)).send({}));
  });

  it("login: dados inválidos, credenciais erradas e 2º fator sem etapa 1", async () => {
    const login = (body) => api().post("/api/auth/login").set("Origin", PANEL_ORIGIN).send(body);
    hasError(await login({}));
    hasError(await login({ email: "x@x.dev", password: "errada" }));
    hasError(await api().post("/api/auth/2fa/verify").set("Origin", PANEL_ORIGIN).send({ code: "123456" }));
  });

  it("login: enquanto o painel antigo pode estar no ar, repete o texto em message", async () => {
    const res = await api().post("/api/auth/login").set("Origin", PANEL_ORIGIN).send({ email: "x@x.dev", password: "errada" });
    expect(res.body.message).toBe(res.body.error);
  });

  it("limite de tentativas (429)", async () => {
    const login = () => api().post("/api/auth/login").set("Origin", PANEL_ORIGIN).send({ email: "x@x.dev", password: "errada" });
    for (let i = 0; i < 10; i++) await login();
    const res = await login();
    expect(res.status).toBe(429);
    hasError(res);
  });

  it("validação de rota, model, ID inválido e rota inexistente", async () => {
    const admin = await asAdmin();
    hasError(await admin.post("/api/posts").send({ title: "ab", category: "design" }));
    hasError(await admin.get("/api/posts/nao-e-id"));
    hasError(await admin.get("/api/posts/64b000000000000000000000"));
    hasError(await api().get("/api/nao-existe"));
  });
});
