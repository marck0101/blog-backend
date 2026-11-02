import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { PANEL_ORIGIN, api, createAdmin, sessionCookie, sign } from "../helpers.mjs";

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");

// SEC-08: trava o comportamento de autenticação do painel (auth.middleware e
// login). Se um destes testes quebrar, alguma porta do painel foi aberta.

const hasSession = (res) => (res.headers["set-cookie"] || []).some((c) => c.startsWith("admin_session=") && !c.startsWith("admin_session=;"));

describe("sessão do painel (auth.middleware)", () => {
  it("sem token: 401", async () => {
    expect((await api().get("/api/posts")).status).toBe(401);
  });

  it("Authorization mal formatado: 401", async () => {
    const res = await api().get("/api/posts").set("Authorization", "Token abc");
    expect(res.status).toBe(401);
  });

  it("token assinado com outro segredo: 401", async () => {
    const user = await createAdmin();
    const jwt = require("jsonwebtoken");
    const forged = jwt.sign({ id: user._id, mfa: true, v: 0 }, "outro-segredo");
    const res = await api().get("/api/posts").set("Cookie", `admin_session=${forged}`);
    expect(res.status).toBe(401);
  });

  it("sessão que não passou pelo 2º fator: 401", async () => {
    const user = await createAdmin();
    const res = await api().get("/api/posts").set("Cookie", sessionCookie(user, { mfa: false }));
    expect(res.status).toBe(401);
  });

  it("cookie da etapa 1 (pendente) não abre o painel: 401", async () => {
    const user = await createAdmin();
    const pending = sign({ id: user._id, stage: "mfa", method: "password", v: 0 }, "10m");
    const res = await api().get("/api/posts").set("Cookie", `admin_session=${pending}`);
    expect(res.status).toBe(401);
  });

  it("sessão de versão antiga (depois de sair ou trocar a senha): 401", async () => {
    const user = await createAdmin({ sessionVersion: 3 });
    const res = await api().get("/api/posts").set("Cookie", sessionCookie(user, { v: 2 }));
    expect(res.status).toBe(401);
  });

  it("usuário desativado: 401", async () => {
    const user = await createAdmin({ active: false });
    expect((await api().get("/api/posts").set("Cookie", sessionCookie(user))).status).toBe(401);
  });

  it("papel diferente de admin: 401", async () => {
    const user = await createAdmin({ role: "editor" });
    expect((await api().get("/api/posts").set("Cookie", sessionCookie(user))).status).toBe(401);
  });

  it("sessão de leitor (comentários) não abre o painel: 401", async () => {
    const reader = sign({ purpose: "reader", sub: "google-123", name: "Leitor" }, "1h");
    const res = await api().get("/api/posts").set("Cookie", `admin_session=${reader}`);
    expect(res.status).toBe(401);
  });

  it("sessão válida: 200", async () => {
    const user = await createAdmin();
    expect((await api().get("/api/posts").set("Cookie", sessionCookie(user))).status).toBe(200);
  });

  it("CSRF: alteração por cookie sem origem do painel: 403", async () => {
    const user = await createAdmin();
    const noOrigin = await api().post("/api/posts").set("Cookie", sessionCookie(user)).send({});
    const otherSite = await api()
      .post("/api/posts")
      .set("Cookie", sessionCookie(user))
      .set("Origin", "https://evil.marck0101.com.br")
      .send({});
    expect(noOrigin.status).toBe(403);
    expect(otherSite.status).toBe(403);
  });

  it("CSRF: com a origem do painel a alteração segue (422 = chegou na validação)", async () => {
    const user = await createAdmin();
    const res = await api().post("/api/posts").set("Cookie", sessionCookie(user)).set("Origin", PANEL_ORIGIN).send({});
    expect(res.status).toBe(422);
  });
});

describe("login por senha (reserva)", () => {
  const PASSWORD = "senha-forte-de-teste";
  const login = (body, origin = PANEL_ORIGIN) => api().post("/api/auth/login").set("Origin", origin).send(body);
  const createWithPassword = async () => createAdmin({ password: await bcrypt.hash(PASSWORD, 4) });

  const ENV_KEYS = ["NODE_ENV", "SKIP_2FA", "VERCEL"];
  const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("origem de fora do painel: 403", async () => {
    await createWithPassword();
    const res = await login({ email: "admin@teste.dev", password: PASSWORD }, "https://evil.example");
    expect(res.status).toBe(403);
  });

  it("operador do MongoDB no lugar do email não passa: 400", async () => {
    await createWithPassword();
    const res = await login({ email: { $ne: null }, password: PASSWORD });
    expect(res.status).toBe(400);
  });

  it("senha errada: 401 sem sessão", async () => {
    await createWithPassword();
    const res = await login({ email: "admin@teste.dev", password: "errada" });
    expect(res.status).toBe(401);
    expect(hasSession(res)).toBe(false);
  });

  it("senha certa ainda não entra: pede o 2º fator e não cria sessão", async () => {
    await createWithPassword();
    const res = await login({ email: "admin@teste.dev", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.next).toBe("verify");
    expect(hasSession(res)).toBe(false);
  });

  it("força bruta: a 11ª tentativa errada em 15 min é bloqueada (429)", async () => {
    await createWithPassword();
    for (let i = 0; i < 10; i++) await login({ email: "admin@teste.dev", password: "errada" });
    const res = await login({ email: "admin@teste.dev", password: PASSWORD });
    expect(res.status).toBe(429);
  });

  it("SKIP_2FA na Vercel (VERCEL=1) não pula o 2º fator", async () => {
    await createWithPassword();
    Object.assign(process.env, { NODE_ENV: "development", SKIP_2FA: "true", VERCEL: "1" });
    const res = await login({ email: "admin@teste.dev", password: PASSWORD });
    expect(res.body.next).toBe("verify");
    expect(hasSession(res)).toBe(false);
  });

  it("SKIP_2FA fora de NODE_ENV=development não pula o 2º fator", async () => {
    await createWithPassword();
    Object.assign(process.env, { NODE_ENV: "test", SKIP_2FA: "true" });
    delete process.env.VERCEL;
    const res = await login({ email: "admin@teste.dev", password: PASSWORD });
    expect(res.body.next).toBe("verify");
    expect(hasSession(res)).toBe(false);
  });

  it("SKIP_2FA só vale em desenvolvimento local (controle: o teste acima detectaria a falha)", async () => {
    await createWithPassword();
    Object.assign(process.env, { NODE_ENV: "development", SKIP_2FA: "true" });
    delete process.env.VERCEL;
    const res = await login({ email: "admin@teste.dev", password: PASSWORD });
    expect(res.body.next).toBe("done");
    expect(hasSession(res)).toBe(true);
  });
});
