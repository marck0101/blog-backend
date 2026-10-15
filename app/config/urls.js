const SITE_URL = "https://blog.marck0101.com.br";
const API_URL = "https://api.blog.marck0101.com.br";

// campaignId: atribui o cancelamento ao envio cujo link foi usado
const unsubscribeUrl = (token, campaignId) =>
  `${API_URL}/api/subscribers/unsubscribe/${token}${campaignId ? `?c=${campaignId}` : ""}`;

// Para onde a API redireciona o navegador (login do painel, login do leitor)
const FRONTEND_URL =
  process.env.NODE_ENV === "production"
    ? process.env.CORS_PROD || SITE_URL
    : process.env.CORS_DEV || "http://localhost:5173";

module.exports = { SITE_URL, API_URL, FRONTEND_URL, unsubscribeUrl };
