// Experimentos do Cockpit: listas fechadas e transições permitidas de status
const AREAS = ["conteudo", "prospeccao", "email", "site", "anuncio", "oferta"];
const STATUSES = ["ideia", "planejado", "rodando", "analisando", "concluido", "descartado"];
const DECISIONS = ["adotar", "descartar", "repetir"];

const TRANSITIONS = {
  ideia: ["planejado", "descartado"],
  planejado: ["ideia", "rodando", "descartado"],
  rodando: ["planejado", "analisando", "descartado"],
  analisando: ["rodando", "concluido", "descartado"],
  concluido: ["analisando"],
  descartado: ["ideia"],
};

const LINK_GROUPS = ["anuncios", "analytics", "sistemas", "documentos", "clientes", "outros"];

module.exports = { AREAS, STATUSES, DECISIONS, TRANSITIONS, LINK_GROUPS };
