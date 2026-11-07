const { SITE_URL } = require("../config/urls");

/**
 * IndexNow (indexnow.org): avisa Bing, Yandex, Seznam, Naver e cia. de que uma
 * URL mudou, em vez de esperar o próximo rastreio do sitemap. O Bing alimenta o
 * Copilot e a busca do ChatGPT, então isso também é GEO. O Google não usa
 * IndexNow (e a Indexing API dele só aceita vagas e lives); lá vale o sitemap.
 *
 * A chave fica em INDEXNOW_KEY e é servida em /indexnow-key.txt no domínio do
 * blog (rewrite do front para a API), que é onde os buscadores conferem.
 * Só roda em produção: URL de teste local não pode ir para os buscadores.
 */
const ENDPOINT = "https://api.indexnow.org/indexnow";
const TIMEOUT_MS = 4000;

const KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

function indexNowKey() {
  const key = (process.env.INDEXNOW_KEY || "").trim();
  return KEY_PATTERN.test(key) ? key : "";
}

const isEnabled = () => process.env.NODE_ENV === "production" && Boolean(indexNowKey());

// URLs que mudam quando um post entra, muda ou sai do ar
function postUrls(post) {
  const urls = [`${SITE_URL}/blog/${post.slug}`, `${SITE_URL}/blog`];
  if (post.season) urls.push(`${SITE_URL}/seasons/${post.season}`);
  return urls;
}

/** Nunca lança: falha no aviso não pode atrapalhar a publicação */
async function pingIndexNow(urls) {
  if (!isEnabled() || !urls?.length) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: new URL(SITE_URL).host,
        key: indexNowKey(),
        keyLocation: `${SITE_URL}/indexnow-key.txt`,
        urlList: [...new Set(urls)],
      }),
      signal: controller.signal,
    });
    // 200 = recebido, 202 = recebido, chave ainda em validação
    if (!res.ok) console.error("[INDEXNOW]", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (err) {
    console.error("[INDEXNOW]", err.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const pingPost = (post) => pingIndexNow(postUrls(post));

module.exports = { indexNowKey, pingIndexNow, pingPost };
