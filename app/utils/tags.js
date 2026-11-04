const slugify = require("slugify");

// Tags do post: assunto fino (ex.: "core-web-vitals", "ga4") que a categoria não
// separa. Servem para as próximas leituras e para o "keywords" do schema; não
// geram páginas próprias (arquivo de tag vira conteúdo fino para o Google).
const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 40;

/** "Core Web Vitals, GA4" ou ["Core Web Vitals"] → ["core-web-vitals", "ga4"] */
function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input ?? "").split(",");
  const tags = [];
  for (const raw of list) {
    const tag = slugify(String(raw ?? ""), { lower: true, strict: true }).slice(0, MAX_TAG_LENGTH).replace(/-+$/, "");
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length === MAX_TAGS) break;
  }
  return tags;
}

module.exports = { normalizeTags, MAX_TAGS };
