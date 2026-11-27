const CLUSTERS = require("../app/config/clusters");

/**
 * Campos de SEO opcionais do post.json / season.json que os scripts de
 * importação repassam ao banco: tema (cluster), pilar, tags, resposta direta e
 * FAQ. Só entra o que está no arquivo, para um --update sem o campo não apagar
 * o que já foi preenchido no painel.
 */
function seoFields(meta, where = "post.json") {
  const out = {};
  if (meta.cluster !== undefined) {
    const cluster = meta.cluster || null;
    if (cluster && !CLUSTERS.some((c) => c.slug === cluster)) {
      throw new Error(`${where}: tema "${cluster}" não existe (veja app/config/clusters.js)`);
    }
    out.cluster = cluster;
    out.isPillar = cluster ? Boolean(meta.isPillar) : false;
  } else if (meta.isPillar) {
    throw new Error(`${where}: escolha o tema (cluster) antes de marcar o post como pilar`);
  }
  if (meta.tags !== undefined) out.tags = meta.tags;
  if (meta.directAnswer !== undefined) {
    if ((meta.directAnswer || "").length > 400) throw new Error(`${where}: directAnswer com mais de 400 caracteres`);
    out.directAnswer = meta.directAnswer;
  }
  if (meta.faq !== undefined) out.faq = meta.faq;
  return out;
}

module.exports = { seoFields };
