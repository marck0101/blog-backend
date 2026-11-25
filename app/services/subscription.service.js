const Subscriber = require("../models/subscriber.model");

/**
 * Inscrição vinda de um formulário público (newsletter, caixinha de sugestões).
 * Regras R-SUB-02 e R-SUB-03 num lugar só:
 * - assinante ativo não é alterado (nem categorias): quem chama responde igual
 *   para email novo e já inscrito, sem revelar quem é assinante;
 * - quem tinha cancelado volta a ativo, com as categorias novas.
 *
 * Devolve o assinante (novo, reativado ou o que já existia).
 */
async function subscribeEmail({ email, name, categories = [], source }) {
  const existing = await Subscriber.findOne({ email: email.toLowerCase().trim() });

  if (existing) {
    if (existing.status === "active") return existing;
    existing.status = "active";
    existing.categories = categories;
    if (name) existing.name = name;
    existing.confirmedAt = new Date();
    existing.unsubscribedAt = null;
    existing.unsubscribeCampaign = null;
    if (source) existing.source = source;
    await existing.save();
    return existing;
  }

  return Subscriber.create({ email, name, categories, source });
}

module.exports = { subscribeEmail };
