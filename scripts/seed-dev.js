/**
 * Popula o banco DEV (local) com dados de teste: posts em todos os status,
 * seasons, posts dentro e fora delas e assinantes (alguns cancelados).
 *
 * Uso:
 *   node scripts/seed-dev.js           # apaga o seed anterior e cria de novo
 *   node scripts/seed-dev.js --clean   # só apaga o seed
 *
 * Regras de segurança:
 * - Só roda com MONGO_URI_DEV apontando para localhost/127.0.0.1 (nunca PROD).
 * - Mexe só no que o próprio seed criou: posts com slug "teste-…", seasons
 *   "teste-…" e assinantes @exemplo.test.
 * - Nenhum post avisa por email nem posta no LinkedIn; agendados ficam no futuro
 *   (o cron não publica nada sozinho).
 */
require("dotenv").config();
const crypto = require("crypto");
const mongoose = require("mongoose");
const BlogPost = require("../app/models/blogpost.model");
const Season = require("../app/models/season.model");
const Subscriber = require("../app/models/subscriber.model");
const CATEGORIES = require("../app/config/categories").map((c) => c.slug);

const CLEAN_ONLY = process.argv.includes("--clean");
const URI = process.env.MONGO_URI_DEV;

const SLUG_PREFIX = "teste-";
const EMAIL_DOMAIN = "exemplo.test";

if (!URI || !/^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(URI)) {
  console.error("MONGO_URI_DEV não é um banco local. O seed só roda em localhost.");
  process.exit(1);
}

// Aleatório com semente: o seed sai igual a cada execução
let rngState = 20261014;
const rand = () => {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const daysAgo = (n) => new Date(now - n * DAY);
// Meio-dia UTC, como o admin grava as datas do calendário
const dayAt = (offset) => {
  const d = new Date(now + offset * DAY);
  d.setUTCHours(12, 0, 0, 0);
  return d;
};

const SEASONS = [
  {
    slug: "teste-fundamentos-de-seo",
    category: "marketing",
    title: "Fundamentos de SEO (teste)",
    description: "Season de teste: do básico de indexação até links internos, em episódios curtos.",
  },
  {
    slug: "teste-carreira-em-tech",
    category: "carreira",
    title: "Carreira em tech (teste)",
    description: "Season de teste: currículo, entrevistas e os primeiros meses no emprego novo.",
  },
  {
    slug: "teste-design-para-devs",
    category: "design",
    title: "Design para devs (teste)",
    description: "Season de teste ainda em planejamento: só rascunhos e agendados, nada publicado.",
  },
];

const TOPICS = [
  "Como medir o que importa", "Erros comuns no primeiro mês", "Checklist antes de publicar",
  "O que aprendi testando por 30 dias", "Guia rápido para iniciantes", "Ferramentas que uso todo dia",
  "Quando não seguir as boas práticas", "Um estudo de caso real", "Perguntas que sempre recebo",
  "Do zero ao primeiro resultado", "Mitos que atrapalham", "Como organizar a rotina",
  "Métricas de vaidade x métricas úteis", "O básico bem feito", "Automatizando o repetitivo",
];

const CATEGORY_LABEL = Object.fromEntries(require("../app/config/categories").map((c) => [c.slug, c.label]));

const FILLER =
  "Cras mattis consectetur purus sit amet fermentum. Aenean lacinia bibendum nulla sed consectetur. " +
  "Maecenas faucibus mollis interdum. Nullam quis risus eget urna mollis ornare vel eu leo. " +
  "Etiam porta sem malesuada magna mollis euismod, donec sed odio dui.";

function content(title) {
  return [
    `<p>Este é um post de teste gerado pelo seed de desenvolvimento: <strong>${title}</strong>.</p>`,
    `<h2>Contexto</h2>`,
    `<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus, posuere velit aliquet.</p>`,
    `<h2>Passo a passo</h2>`,
    `<ul><li>Defina o objetivo.</li><li>Escolha uma métrica.</li><li>Teste, meça e ajuste.</li></ul>`,
    `<p>Donec ullamcorper nulla non metus auctor fringilla. Vestibulum id ligula porta felis euismod semper.</p>`,
    // Tamanho variado: tempo de leitura de ~1 a ~10 min
    ...Array.from({ length: int(2, 60) }, () => `<p>${FILLER}</p>`),
  ].join("\n");
}

let counter = 0;
function makePost({ status, trash = false, season = null, seasonOrder = null, category = pick(CATEGORIES) }) {
  counter += 1;
  const title = `${pick(TOPICS)} em ${CATEGORY_LABEL[category]} #${counter}`;
  const slug = `${SLUG_PREFIX}${String(counter).padStart(3, "0")}-${title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

  let createdAt;
  let publishedAt = null;
  let plannedAt = null;

  if (status === "published") {
    publishedAt = daysAgo(int(1, 240));
    createdAt = new Date(publishedAt.getTime() - int(1, 10) * DAY);
  } else if (status === "planned") {
    plannedAt = dayAt(int(2, 60));
    createdAt = daysAgo(int(0, 20));
  } else {
    createdAt = daysAgo(int(0, 60));
    // Metade dos rascunhos tem data no calendário editorial
    if (rand() < 0.5) plannedAt = dayAt(int(-5, 45));
  }

  const doc = new BlogPost({
    title,
    slug,
    excerpt: `Resumo do post de teste #${counter}. Serve para ver cards, listas e buscas com texto real.`,
    content: status === "draft" && rand() < 0.2 ? "" : content(title),
    status,
    published: status === "published",
    publishedAt,
    plannedAt,
    category,
    season,
    seasonOrder,
    coverImage: rand() < 0.8 ? `https://picsum.photos/seed/${slug}/1200/630` : undefined,
    emailNotify: false,
    linkedin: { enabled: false },
    views: status === "published" ? int(0, 3000) : 0,
    deletedAt: trash ? new Date(createdAt.getTime() + int(0, 5) * DAY) : null,
  });
  const err = doc.validateSync();
  if (err) throw err;

  const obj = doc.toObject();
  obj.createdAt = createdAt;
  obj.updatedAt = publishedAt || createdAt;
  return obj;
}

function buildPosts() {
  const posts = [];

  // 50 publicados "comuns"
  for (let i = 0; i < 50; i++) posts.push(makePost({ status: "published" }));

  // 50 misturados: rascunho, agendado, publicado e lixeira (com status variados)
  for (let i = 0; i < 15; i++) posts.push(makePost({ status: "draft" }));
  for (let i = 0; i < 15; i++) posts.push(makePost({ status: "planned" }));
  for (let i = 0; i < 10; i++) posts.push(makePost({ status: "published" }));
  for (let i = 0; i < 10; i++) posts.push(makePost({ status: pick(["draft", "planned", "published"]), trash: true }));

  // Seasons: episódios em ordem, com status que fazem sentido para uma série
  const plans = {
    "teste-fundamentos-de-seo": ["published", "published", "published", "published", "planned", "planned", "draft"],
    "teste-carreira-em-tech": ["published", "published", "draft", "draft", "published-trash"],
    "teste-design-para-devs": ["planned", "draft", "draft", "draft"],
  };
  for (const season of SEASONS) {
    plans[season.slug].forEach((plan, i) => {
      const [status, trash] = plan.split("-");
      posts.push(
        makePost({
          status,
          trash: trash === "trash",
          season: season.slug,
          seasonOrder: i + 1,
          category: season.category,
        })
      );
    });
  }

  // Na season "Fundamentos de SEO", publicados saem em ordem de episódio
  const seo = posts
    .filter((p) => p.season === "teste-fundamentos-de-seo" && p.status === "published")
    .sort((a, b) => a.seasonOrder - b.seasonOrder);
  seo.forEach((p, i) => {
    p.publishedAt = daysAgo(40 - i * 7);
    p.createdAt = new Date(p.publishedAt.getTime() - 3 * DAY);
    p.updatedAt = p.publishedAt;
  });

  return posts;
}

const FIRST = ["Ana", "Bruno", "Carla", "Diego", "Eduarda", "Felipe", "Gabriela", "Heitor", "Isabela", "João",
  "Larissa", "Marcelo", "Natália", "Otávio", "Paula", "Rafael", "Sofia", "Thiago", "Vitória", "Yuri"];
const LAST = ["Silva", "Souza", "Oliveira", "Santos", "Lima", "Pereira", "Costa", "Almeida", "Rocha", "Martins"];

function buildSubscribers(publishedSlugs) {
  const subs = [];
  for (let i = 1; i <= 100; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const email = `${name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(" ", ".")}.${i}@${EMAIL_DOMAIN}`;
    const createdAt = daysAgo(int(0, 180));
    const unsubscribed = i % 5 === 0; // 20 cancelados
    const member = !unsubscribed && rand() < 0.15;
    const location = pick(["home", "home", "post", "post", "post", "manual"]);
    const cats = [...CATEGORIES].sort(() => rand() - 0.5).slice(0, int(0, 3));

    const doc = new Subscriber({
      email,
      name: rand() < 0.9 ? name : "",
      categories: cats,
      tier: member ? "member" : "free",
      memberSince: member ? new Date(createdAt.getTime() + int(1, 20) * DAY) : null,
      notes: member ? "Membro de teste (seed)" : "",
      status: unsubscribed ? "unsubscribed" : "active",
      token: crypto.randomBytes(32).toString("hex"),
      confirmedAt: createdAt,
      unsubscribedAt: unsubscribed ? new Date(createdAt.getTime() + int(1, 30) * DAY) : null,
      source:
        location === "manual"
          ? { location: "manual" }
          : {
              location,
              path: location === "home" ? "/" : `/blog/${pick(publishedSlugs)}`,
              post: location === "post" ? pick(publishedSlugs) : "",
              landingPath: "/",
              referrer: pick(["", "google.com", "linkedin.com", "instagram.com"]),
              utmSource: pick(["", "", "linkedin", "newsletter"]),
              utmMedium: pick(["", "", "social", "email"]),
              utmCampaign: pick(["", "", "lancamento-season"]),
            },
    });
    const err = doc.validateSync();
    if (err) throw err;
    const obj = doc.toObject();
    obj.createdAt = createdAt;
    obj.updatedAt = obj.unsubscribedAt || createdAt;
    subs.push(obj);
  }
  return subs;
}

async function clean() {
  const [p, s, a] = await Promise.all([
    BlogPost.deleteMany({ slug: { $regex: `^${SLUG_PREFIX}` } }),
    Season.deleteMany({ slug: { $regex: `^${SLUG_PREFIX}` } }),
    Subscriber.deleteMany({ email: { $regex: `@${EMAIL_DOMAIN.replace(".", "\\.")}$` } }),
  ]);
  console.log(`[seed] removidos: ${p.deletedCount} posts, ${s.deletedCount} seasons, ${a.deletedCount} assinantes`);
}

async function main() {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 });
  console.log(`[seed] banco ${mongoose.connection.name} @ ${mongoose.connection.host}`);

  await clean();
  if (CLEAN_ONLY) return;

  const maxOrder = (await Season.findOne().sort({ order: -1 }).select("order").lean())?.order ?? 0;
  await Season.insertMany(SEASONS.map(({ category: _category, ...s }, i) => ({ ...s, order: maxOrder + 1 + i })));

  const posts = buildPosts();
  // Inserção direta: mantém createdAt/publishedAt no passado (o Mongoose sobrescreveria)
  await BlogPost.collection.insertMany(posts);

  const publishedSlugs = posts.filter((p) => p.status === "published" && !p.deletedAt).map((p) => p.slug);
  const subs = buildSubscribers(publishedSlugs);
  await Subscriber.collection.insertMany(subs);

  const count = (fn) => posts.filter(fn).length;
  const live = (p) => !p.deletedAt;
  console.log(`[seed] ${SEASONS.length} seasons`);
  console.log(
    `[seed] ${posts.length} posts: ${count((p) => live(p) && p.status === "published")} publicados, ` +
      `${count((p) => live(p) && p.status === "planned")} agendados, ` +
      `${count((p) => live(p) && p.status === "draft")} rascunhos, ${count((p) => !live(p))} na lixeira ` +
      `(${count((p) => p.season)} em seasons)`
  );
  console.log(
    `[seed] ${subs.length} assinantes: ${subs.filter((s) => s.status === "active").length} ativos, ` +
      `${subs.filter((s) => s.status === "unsubscribed").length} cancelados, ${subs.filter((s) => s.tier === "member").length} membros`
  );
}

main()
  .catch((err) => {
    console.error("[seed]", err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
