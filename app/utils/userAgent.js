// Robôs, buscadores, antivírus de email (abrem e clicam em tudo ao receber),
// pré-visualização de links e ferramentas de linha de comando. Usado para não
// contar como pessoa: leituras de post (BIZ-02) e aberturas/cliques de email.
const BOT_UA =
  /bot|spider|crawl|slurp|scan|preview|monitor|lighthouse|pagespeed|curl|wget|python|java\/|go-http|axios|node-fetch|headless|phantom|proofpoint|mimecast|barracuda|fortiguard|safelinks/i;

/** User-agent de robô (ou ausente, que navegador de verdade sempre manda) */
function isBot(userAgent) {
  return !userAgent || BOT_UA.test(userAgent);
}

module.exports = { isBot };
