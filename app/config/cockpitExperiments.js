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

// Espaços do site que aceitam variante de texto (Sprint R5); cada um precisa de código no front
const ALVOS = ["pre-diagnostico-cta"];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VARIANTES_MIN = 2;
const VARIANTES_MAX = 4;

const LINK_GROUPS = ["anuncios", "analytics", "sistemas", "documentos", "clientes", "outros"];

module.exports = { AREAS, STATUSES, DECISIONS, TRANSITIONS, LINK_GROUPS, ALVOS, SLUG, VARIANTES_MIN, VARIANTES_MAX };
