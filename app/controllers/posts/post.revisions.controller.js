const connectDB = require("../../config/db.config");
const BlogPost = require("../../models/blogpost.model");
const revisions = require("../../services/postRevision.service");
const { seasonExists } = require("../../services/season.service");
const { sanitizeHtml } = require("../../utils/sanitizeHtml");
const { validatePost, revisionAuthor } = require("./post.rules");

/**
 * Histórico de versões do post no painel (R-REV-01 a 04): listar, ver uma
 * versão e restaurar. A gravação das versões fica em services/postRevision.service.js.
 */

const parseVersion = (value) => {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
};

/**
 * HISTÓRICO — versões do post, mais nova primeiro (sem o conteúdo)
 */
exports.listRevisions = async (req, res, next) => {
  try {
    await connectDB();

    if (!(await BlogPost.exists({ _id: req.params.id }))) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    res.json(await revisions.listRevisions(req.params.id));
  } catch (err) {
    next(err);
  }
};

/**
 * HISTÓRICO — uma versão completa
 */
exports.getRevision = async (req, res, next) => {
  try {
    await connectDB();

    const version = parseVersion(req.params.version);
    const revision = version && (await revisions.getRevision(req.params.id, version));
    if (!revision) {
      return res.status(404).json({ error: "Versão não encontrada" });
    }

    res.json(revision);
  } catch (err) {
    next(err);
  }
};

/**
 * HISTÓRICO — restaura uma versão. Não apaga nada: o conteúdo dela vira uma
 * versão nova (o estado de antes continua no histórico). Status, datas, email
 * e LinkedIn não mudam; o endereço (slug) atual é mantido para não quebrar links.
 */
exports.restoreRevision = async (req, res, next) => {
  try {
    await connectDB();

    const version = parseVersion(req.params.version);
    const revision = version && (await revisions.getRevision(req.params.id, version));
    if (!revision) {
      return res.status(404).json({ error: "Versão não encontrada" });
    }

    const existing = await BlogPost.findById(req.params.id).select("status plannedAt content slug season").lean();
    if (!existing) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    const fields = Object.fromEntries(
      revisions.REVISION_FIELDS.filter((f) => f !== "slug").map((f) => [f, revision.snapshot[f]])
    );
    // Sem o slug no update, mudar o título geraria um endereço novo
    fields.slug = existing.slug;
    // Versão gravada antes da limpeza de HTML (SEC-01) volta já limpa
    fields.content = sanitizeHtml(fields.content);
    // Season apagada depois da versão: o post fica na season atual
    if (fields.season && !(await seasonExists(fields.season))) {
      fields.season = existing.season ?? null;
    }

    const validationError = validatePost(fields, false, existing);
    if (validationError) {
      return res.status(422).json({ error: validationError });
    }

    await revisions.ensureBaseline(req.params.id);

    const post = await BlogPost.findByIdAndUpdate(req.params.id, fields, {
      new: true,
      runValidators: true,
    });

    await revisions.safeRecordRevision(post, {
      reason: "restore",
      restoredFrom: version,
      author: revisionAuthor(req),
    });

    res.json(post);
  } catch (err) {
    next(err);
  }
};
