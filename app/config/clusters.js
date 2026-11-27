// Temas do blog (clusters de conteúdo, R-CLU-01): model, validação e
// /api/clusters leem daqui. Tema novo = uma linha nesta lista.
// Cada tema tem no máximo um post pilar (isPillar), que resume o assunto e
// linka os outros posts do tema. Plano: "Plano SEO, GEO e clusters" (nov/2026).
const CLUSTERS = [
  {
    slug: "dashboards-e-bi",
    title: "Dashboards e BI de marketing",
    description:
      "Como montar dashboards de marketing que o cliente abre todo dia: metas, funil, tooltip em cada KPI, segurança e LGPD.",
  },
  {
    slug: "site-rapido-e-encontravel",
    title: "Site rápido, seguro e encontrável",
    description:
      "SEO técnico e GEO na prática: velocidade, segurança, arquitetura e o que faz o Google e as IAs lerem o seu site.",
  },
  {
    slug: "trafego-pago-medido",
    title: "Tráfego pago medido",
    description:
      "Google Ads e Meta Ads para pequenas e médias empresas do interior do RS, com tracking configurado antes do primeiro real.",
  },
  {
    slug: "seguranca-na-diretoria",
    title: "Segurança é pauta de diretoria",
    description:
      "Como os ataques acontecem, quanto custam e o que líderes precisam conversar com o time e os parceiros.",
    // Sem post pilar: a season é a porta de entrada do tema (página do tema mostra "Comece pela série")
    season: "seguranca-e-pauta-de-diretoria",
  },
  {
    slug: "engenharia-no-marketing",
    title: "Engenharia no marketing",
    description: "Automação, ferramentas e código a serviço do marketing: o que construo e como uso no dia a dia.",
  },
];

module.exports = CLUSTERS;
// Só os slugs (fora do JSON de /api/clusters: res.json de array ignora esta propriedade)
module.exports.SLUGS = CLUSTERS.map((c) => c.slug);
