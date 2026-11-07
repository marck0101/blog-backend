const { str } = require("./sanitize");

/**
 * Ordenação padrão das listas do painel (?sort=<chave>).
 *
 * Cada tela declara suas ordens:
 *   { chave: { sort, collation?, emptyLast?, addFields? } }
 *   - sort       — ordem do MongoDB; termine com _id para a paginação não repetir item
 *   - collation  — ex.: { locale: "pt", strength: 1 } para A-Z sem diferenciar acento/caixa
 *   - emptyLast  — campo de texto: vazios vão para o fim (nome em branco não abre a lista)
 *   - addFields  — campo calculado para ordenar ($addFields); some da resposta
 * A primeira chave é a padrão.
 */
const COLLATION_PT = { locale: "pt", strength: 1 };

function pickSort(sorts, value) {
  const key = str(value);
  return Object.prototype.hasOwnProperty.call(sorts, key) ? key : Object.keys(sorts)[0];
}

/**
 * Busca já ordenada e paginada. Devolve objetos simples (lean), como o JSON
 * de antes. `exclude`: campos que nunca saem (ex.: token).
 */
function sortedFind(Model, filter, def, { skip = 0, limit = 0, exclude = [] } = {}) {
  const extra = { ...(def.addFields || {}) };
  if (def.emptyLast) {
    extra._emptyLast = {
      $cond: [{ $gt: [{ $strLenCP: { $trim: { input: { $ifNull: [`$${def.emptyLast}`, ""] } } } }, 0] }, 0, 1],
    };
  }

  if (Object.keys(extra).length) {
    const sort = def.emptyLast ? { _emptyLast: 1, ...def.sort } : def.sort;
    const hidden = Object.fromEntries([...Object.keys(extra), ...exclude].map((f) => [f, 0]));
    const pipeline = [
      // cast: ids em string viram ObjectId, como no find()
      { $match: Model.find(filter).cast() },
      { $addFields: extra },
      { $sort: sort },
      ...(skip ? [{ $skip: skip }] : []),
      ...(limit ? [{ $limit: limit }] : []),
      { $project: hidden },
    ];
    const agg = Model.aggregate(pipeline);
    return def.collation ? agg.collation(def.collation) : agg;
  }

  let query = Model.find(filter, exclude.map((f) => `-${f}`).join(" ")).sort(def.sort);
  if (skip) query = query.skip(skip);
  if (limit) query = query.limit(limit);
  if (def.collation) query = query.collation(def.collation);
  return query.lean();
}

module.exports = { COLLATION_PT, pickSort, sortedFind };
