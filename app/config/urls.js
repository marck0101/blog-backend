const SITE_URL = "https://blog.marck0101.com.br";
const API_URL = "https://api.blog.marck0101.com.br";

const unsubscribeUrl = (token) => `${API_URL}/api/subscribers/unsubscribe/${token}`;

module.exports = { SITE_URL, API_URL, unsubscribeUrl };
