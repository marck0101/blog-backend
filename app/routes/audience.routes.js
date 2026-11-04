const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const auth = require("../middlewares/auth.middleware");
const connectDB = require("../config/db.config");
const AudienceList = require("../models/audienceList.model");
const Subscriber = require("../models/subscriber.model");
const Campaign = require("../models/campaign.model");
const BlogPost = require("../models/blogpost.model");
const { str } = require("../utils/sanitize");
const { categoriesError, isEmail } = require("../utils/validators");
const { validate } = require("../validation/validate");
const { createBody, updateBody, importBody } = require("../validation/audiences.schemas");

/**
 * Públicos nomeados (listas) do painel: criar, renomear, excluir e importar
 * pessoas a partir de uma lista de nomes e emails.
 */
const router = express.Router();
router.use(auth);

function validId(req, res) {
  if (mongoose.isValidObjectId(req.params.id)) return true;
  res.status(404).json({ error: "Público não encontrado" });
  return false;
}

const NAME_TAKEN = "Já existe um público com esse nome";

// Nome repetido: avisa se o outro está na lixeira (dá para restaurar em vez de recriar)
async function nameTakenMessage(name) {
  const other = await AudienceList.findOne({ name, deletedAt: { $ne: null } })
    .collation({ locale: "pt", strength: 2 })
    .lean();
  return other ? `${NAME_TAKEN} na lixeira. Restaure-o ou escolha outro nome.` : NAME_TAKEN;
}

// Rascunhos que ficariam sem destinatários (ou mandariam para um público
// apagado) se o público sair: envios em rascunho e emails de posts ainda não publicados
async function usedInDrafts(id) {
  const [campaigns, posts] = await Promise.all([
    Campaign.countDocuments({ status: "draft", "audience.type": "lists", "audience.lists": id }),
    BlogPost.countDocuments({
      deletedAt: null,
      published: { $ne: true },
      "emailAudience.type": "lists",
      "emailAudience.lists": id,
    }),
  ]);
  const parts = [];
  if (campaigns) parts.push(`${campaigns} envio(s) em rascunho`);
  if (posts) parts.push(`${posts} post(s) não publicado(s)`);
  return parts.length ? `Este público está em ${parts.join(" e ")}. Troque o público deles antes.` : null;
}

// Públicos (do painel ou da lixeira) com total de pessoas e quantas estão ativas
async function listWithCounts(filter, sort) {
  const [lists, counts] = await Promise.all([
    AudienceList.find(filter).sort(sort).lean(),
    Subscriber.aggregate([
      { $match: { lists: { $exists: true, $ne: [] } } },
      { $unwind: "$lists" },
      {
        $group: {
          _id: "$lists",
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c]));
  return lists.map((l) => ({
    ...l,
    total: byId.get(String(l._id))?.total || 0,
    active: byId.get(String(l._id))?.active || 0,
  }));
}

// Públicos ativos (fora da lixeira): painel e seletor de envios
router.get("/", async (req, res, next) => {
  try {
    await connectDB();
    res.json(await listWithCounts({ deletedAt: null }, { createdAt: -1 }));
  } catch (err) {
    next(err);
  }
});

router.get("/trash", async (req, res, next) => {
  try {
    await connectDB();
    res.json(await listWithCounts({ deletedAt: { $ne: null } }, { deletedAt: -1 }));
  } catch (err) {
    next(err);
  }
});

router.post("/", validate({ body: createBody }), async (req, res, next) => {
  try {
    await connectDB();
    const list = await AudienceList.create(req.body);
    res.status(201).json({ ...list.toObject(), total: 0, active: 0 });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: await nameTakenMessage(req.body.name) });
    next(err);
  }
});

router.patch("/:id", validate({ body: updateBody }), async (req, res, next) => {
  try {
    if (!validId(req, res)) return;
    await connectDB();
    const list = await AudienceList.findOneAndUpdate({ _id: req.params.id, deletedAt: null }, req.body, {
      new: true,
      runValidators: true,
    });
    if (!list) return res.status(404).json({ error: "Público não encontrado" });
    res.json(list);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: await nameTakenMessage(req.body.name) });
    next(err);
  }
});

// Manda para a lixeira. As pessoas continuam ligadas ao público, só que ele
// some do painel e dos envios até ser restaurado.
router.delete("/:id", async (req, res, next) => {
  try {
    if (!validId(req, res)) return;
    await connectDB();

    const inUse = await usedInDrafts(req.params.id);
    if (inUse) return res.status(409).json({ error: inUse });

    const list = await AudienceList.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
      { new: true }
    );
    if (!list) return res.status(404).json({ error: "Público não encontrado" });
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/restore", async (req, res, next) => {
  try {
    if (!validId(req, res)) return;
    await connectDB();
    const list = await AudienceList.findOneAndUpdate(
      { _id: req.params.id, deletedAt: { $ne: null } },
      { $set: { deletedAt: null } },
      { new: true }
    );
    if (!list) return res.status(404).json({ error: "Público não está na lixeira" });
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// Exclui de vez (só da lixeira): apaga o público e desfaz o vínculo das
// pessoas, que continuam como assinantes
router.delete("/:id/hard", async (req, res, next) => {
  try {
    if (!validId(req, res)) return;
    await connectDB();

    const inUse = await usedInDrafts(req.params.id);
    if (inUse) return res.status(409).json({ error: inUse });

    const list = await AudienceList.findOneAndDelete({ _id: req.params.id, deletedAt: { $ne: null } });
    if (!list) return res.status(404).json({ error: "Público não está na lixeira" });
    await Subscriber.updateMany({ lists: list._id }, { $pull: { lists: list._id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Tira uma pessoa do público (ela continua assinante)
router.delete("/:id/members/:subscriberId", async (req, res, next) => {
  try {
    if (!validId(req, res) || !mongoose.isValidObjectId(req.params.subscriberId)) return;
    await connectDB();
    await Subscriber.updateOne({ _id: req.params.subscriberId }, { $pull: { lists: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Importa pessoas para o público.
 * body: { rows: [{ email, name }], categories: [slug], consent: true }
 *   - email novo: vira assinante ativo, gratuito, origem "import", no público
 *   - email que já existe: só entra no público (nome preenchido se estava vazio);
 *     quem cancelou continua cancelado e não recebe nada
 * Devolve o resumo do que aconteceu com cada linha.
 */
router.post("/:id/import", validate({ body: importBody }), async (req, res, next) => {
  try {
    if (!validId(req, res)) return;
    // Consentimento, quantidade de linhas e formato: esquema (importBody)
    const { rows, categories } = req.body;
    const categoryError = categoriesError(categories);
    if (categoryError) return res.status(422).json({ error: categoryError });

    await connectDB();
    const list = await AudienceList.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!list) return res.status(404).json({ error: "Público não encontrado ou na lixeira" });

    // Limpa e tira repetidos do próprio arquivo
    const invalid = [];
    const byEmail = new Map();
    rows.forEach((row, i) => {
      const email = str(row?.email).toLowerCase();
      const name = str(row?.name).slice(0, 120);
      if (!isEmail(email)) {
        invalid.push({ line: row?.line ?? i + 1, email: email || "(vazio)" });
        return;
      }
      if (!byEmail.has(email)) byEmail.set(email, name);
      else if (!byEmail.get(email) && name) byEmail.set(email, name);
    });

    const emails = [...byEmail.keys()];
    const existing = await Subscriber.find({ email: { $in: emails } }, "email name status lists").lean();
    const existingByEmail = new Map(existing.map((s) => [s.email, s]));

    const summary = { created: 0, added: 0, alreadyInList: 0, unsubscribed: 0, invalid, duplicatesInFile: rows.length - invalid.length - emails.length };
    const ops = [];
    const now = new Date();

    for (const [email, name] of byEmail) {
      const sub = existingByEmail.get(email);
      if (!sub) {
        summary.created++;
        ops.push({
          insertOne: {
            document: {
              email,
              name,
              categories,
              tier: "free",
              status: "active",
              lists: [list._id],
              token: crypto.randomBytes(32).toString("hex"),
              confirmedAt: now,
              source: { location: "import", list: list._id },
              notes: `Importado no público "${list.name}" em ${now.toLocaleDateString("pt-BR")}`,
              createdAt: now,
              updatedAt: now,
            },
          },
        });
        continue;
      }

      const inList = (sub.lists || []).some((id) => String(id) === String(list._id));
      if (sub.status !== "active") summary.unsubscribed++;
      else if (inList) summary.alreadyInList++;
      else summary.added++;

      const update = { $addToSet: { lists: list._id } };
      if (!sub.name && name) update.$set = { name };
      if (!inList || update.$set) ops.push({ updateOne: { filter: { _id: sub._id }, update } });
    }

    if (ops.length) await Subscriber.bulkWrite(ops, { ordered: false });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
