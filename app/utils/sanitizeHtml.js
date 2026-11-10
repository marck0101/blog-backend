const sanitize = require("sanitize-html");

// HTML de post e de envio: só o que o editor (TipTap) e os imports de
// content/ produzem. Script, eventos (onerror=…), iframe, formulário e
// javascript: somem. Se o editor ganhar um recurso novo (tabela, vídeo…), a
// tag entra aqui, com teste em tests/security/sanitize-html.test.mjs.
const OPTIONS = {
  allowedTags: [
    "p", "br", "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "b", "em", "i", "u", "s", "strike", "code", "pre", "blockquote",
    "ul", "ol", "li", "hr", "a", "img", "span",
    "table", "thead", "tbody", "tr", "th", "td", "figure", "figcaption",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel", "title"],
    img: ["src", "alt", "title", "width", "height", "style", "loading"],
    ol: ["start"],
    code: ["class"],
    pre: ["class"],
    "*": ["style"],
  },
  // style só com o que o editor usa: alinhamento e tamanho de imagem
  allowedStyles: {
    "*": { "text-align": [/^(left|right|center|justify)$/] },
    img: {
      width: [/^\d+(\.\d+)?(px|%)$/],
      height: [/^auto$|^\d+(px|%)$/],
      display: [/^block$/],
    },
  },
  allowedClasses: { code: [/^language-[\w-]+$/], pre: [/^language-[\w-]+$/] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  // Link que abre em outra aba não dá acesso à página do blog (window.opener)
  transformTags: {
    a: (tagName, attribs) => {
      if (attribs.target === "_blank") {
        const rel = new Set((attribs.rel || "").split(/\s+/).filter(Boolean));
        rel.add("noopener");
        rel.add("noreferrer");
        attribs.rel = [...rel].join(" ");
      }
      return { tagName, attribs };
    },
  },
};

/** HTML seguro para guardar e exibir. Texto que não é string vira "". */
function sanitizeHtml(html) {
  return typeof html === "string" ? sanitize(html, OPTIONS) : "";
}

// Sinais de conteúdo perigoso (para o script de varredura listar o que tinha risco)
const DANGER = /<\s*(script|iframe|object|embed|form|style|link|meta)\b|\son\w+\s*=|javascript:|data:text\/html/i;
const looksDangerous = (html) => typeof html === "string" && DANGER.test(html);

module.exports = { sanitizeHtml, looksDangerous };
