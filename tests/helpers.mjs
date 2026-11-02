import { createRequire } from "node:module";
import request from "supertest";

// Tudo da app por require nativo (mesmas instâncias que as rotas usam)
const require = createRequire(import.meta.url);

export const app = require("../app/app");
export const connectDB = require("../app/config/db.config");
export const transporter = require("../app/config/mailer");
export const { sign } = require("../app/utils/session");

export const models = {
  BlogPost: require("../app/models/blogpost.model"),
  Campaign: require("../app/models/campaign.model"),
  Comment: require("../app/models/comment.model"),
  PostDailyStat: require("../app/models/postDailyStat.model"),
  PostRevision: require("../app/models/postRevision.model"),
  Season: require("../app/models/season.model"),
  Subscriber: require("../app/models/subscriber.model"),
  User: require("../app/models/user.model"),
};

// Origem do painel aceita pelo CORS e pela checagem de CSRF
export const PANEL_ORIGIN = "http://localhost:5173";

export const api = () => request(app);

/** Admin com 2º fator já cadastrado (como em produção) */
export async function createAdmin(overrides = {}) {
  await connectDB();
  return models.User.create({
    name: "Admin Teste",
    email: "admin@teste.dev",
    password: "hash-irrelevante",
    role: "admin",
    mfa: { enabledAt: new Date() },
    ...overrides,
  });
}

/** Cookie de sessão do painel, igual ao que o login emite depois do 2º fator */
export function sessionCookie(user, payload = {}) {
  const token = sign({ id: user._id, role: user.role, mfa: true, v: user.sessionVersion || 0, ...payload }, "1h");
  return `admin_session=${token}`;
}

/**
 * Requisições como admin logado no painel (cookie + origem do painel).
 * Ex.: const admin = await asAdmin(); await admin.post("/api/posts").send({...})
 */
export async function asAdmin(overrides) {
  const user = await createAdmin(overrides);
  const cookie = sessionCookie(user);
  const withSession = (method) => (url) => api()[method](url).set("Cookie", cookie).set("Origin", PANEL_ORIGIN);
  return {
    user,
    get: withSession("get"),
    post: withSession("post"),
    put: withSession("put"),
    patch: withSession("patch"),
    delete: withSession("delete"),
  };
}

/** Post direto no banco (sem passar pelas regras da rota) */
export async function createPost(overrides = {}) {
  await connectDB();
  return models.BlogPost.create({
    title: "Post de teste",
    content: "<p>Conteúdo de teste com mais de dez caracteres.</p>",
    category: "tecnologia",
    ...overrides,
  });
}
