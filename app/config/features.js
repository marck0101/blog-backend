// Recursos do blog que o painel liga e desliga com um clique (Recursos do blog).
// Padrão = ligado: banco fora do ar ou documento ainda não criado não tiram
// nada do leitor. Nome novo aqui precisa também de src/utils/features.js no front.
const FEATURES = {
  skins: true, // Estilos de época (Jornal e Terminal): seletor e estilo salvo do leitor
  terminalOffer: true, // Convite do Terminal nos posts de Tecnologia
  toc: true, // Sumário "Neste post"
  readingProgress: true, // Barra de leitura no topo do post
};

const FEATURE_NAMES = Object.keys(FEATURES);

module.exports = { FEATURES, FEATURE_NAMES };
