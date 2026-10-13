const SITE_URL = "https://blog.marck0101.com.br";
const API_URL = "https://api.blog.marck0101.com.br";

// campaignId: atribui o cancelamento ao envio cujo link foi usado
const unsubscribeUrl = (token, campaignId) =>
  `${API_URL}/api/subscribers/unsubscribe/${token}${campaignId ? `?c=${campaignId}` : ""}`;

module.exports = { SITE_URL, API_URL, unsubscribeUrl };
