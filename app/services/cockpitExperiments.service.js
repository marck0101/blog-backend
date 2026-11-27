const { TRANSITIONS } = require("../config/cockpitExperiments");

/**
 * Regras de mudança de status de um experimento (R-COCKPIT-06).
 * `exp` é o experimento atual; `patch` é o que a requisição quer gravar junto
 * (result parcial). Devolve { error } ou { set } com os campos a gravar.
 */
function planTransition(exp, to, resultPatch = {}, now = new Date()) {
  const from = exp.status;
  if (from === to) return { error: "O experimento já está nesse status" };
  if (!(TRANSITIONS[from] || []).includes(to)) return { error: `Não dá para ir de "${from}" para "${to}"` };

  const result = { ...(exp.result?.toObject ? exp.result.toObject() : exp.result || {}), ...resultPatch };
  const set = { status: to };
  if (Object.keys(resultPatch).length) set.result = result;

  if (to === "rodando") {
    const missing = [];
    if (!exp.metric) missing.push("métrica principal");
    if (!exp.plannedEnd) missing.push("data prevista de fim");
    if ((exp.variants || []).length < 2) missing.push("pelo menos 2 variantes");
    if (missing.length) return { error: `Para rodar falta: ${missing.join(", ")}` };
    if (!exp.startedAt) set.startedAt = now;
  }
  if (to === "concluido") {
    const missing = [];
    if (!String(result.summary || "").trim()) missing.push("resumo do resultado");
    if (!result.decision) missing.push("decisão");
    if (!String(result.learning || "").trim()) missing.push("aprendizado");
    if (missing.length) return { error: `Para concluir falta: ${missing.join(", ")}` };
  }
  if (to === "concluido" || to === "descartado") set.finishedAt = now;
  else set.finishedAt = null;
  if (to === "ideia" || to === "planejado") set.startedAt = null;
  return { set };
}

/**
 * Sorteio no site (R5): chave, alvo e variantes andam juntos (os três ou nenhum).
 * Devolve mensagem de erro ou null.
 */
function siteDraftError(exp) {
  const temVariantes = (exp.variantes || []).length > 0;
  const preenchidos = [Boolean(exp.chave), Boolean(exp.alvo), temVariantes].filter(Boolean).length;
  if (preenchidos !== 0 && preenchidos !== 3) return "Sorteio no site pede chave, alvo e variantes juntos";
  return null;
}

/** Já existe outro experimento rodando no mesmo espaço do site? (senão dois sorteios brigam pelo mesmo texto) */
async function alvoOcupado(Experiment, exp) {
  if (!exp.alvo) return false;
  const outro = await Experiment.exists({ _id: { $ne: exp._id }, deletedAt: null, status: "rodando", alvo: exp.alvo });
  return Boolean(outro);
}

/** Formato público do sorteio: só o que o site precisa, nunca hipótese, métrica, notas ou id */
function toPublicActive(exp) {
  return {
    chave: exp.chave,
    alvo: exp.alvo,
    variantes: (exp.variantes || []).map((v) => ({ chave: v.chave, texto: v.texto })),
  };
}

// Experimentos rodando que passaram da data prevista (viram item em "precisa de ação")
async function overdueRunning(Experiment, now = new Date()) {
  return Experiment.find({ deletedAt: null, status: "rodando", plannedEnd: { $lt: now } })
    .select("title plannedEnd")
    .lean();
}

module.exports = { planTransition, overdueRunning, siteDraftError, alvoOcupado, toPublicActive };
