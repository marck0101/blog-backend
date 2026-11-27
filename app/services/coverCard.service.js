// Capa automática 1200x630 no padrão "Relatório" da marca (Sprint R6).
// Usada só quando o post não tem capa própria (nunca sobrescreve coverImage).
//
// Como funciona: o texto é convertido em caminhos vetoriais (opentype.js, fontes
// embutidas em app/assets/fonts) e o SVG resultante vira PNG pelo sharp, que já é
// dependência do projeto. Assim o resultado não depende de fontes instaladas na
// Vercel nem de escape de texto em SVG: não existe <text>, só <path>.
const fs = require("fs");
const path = require("path");
const opentype = require("opentype.js");
const sharp = require("sharp");

const WIDTH = 1200;
const HEIGHT = 630;

// Tokens do BRAND.md / marck0101-temas.css. Sem degradê, sem cor de semáforo.
const THEMES = {
  claro: { bg: "#F4F1EA", ink: "#1C2733", note: "#8A8578", rule: "#D8D2C4", brick: "#D9542B", markBg: "#1C2733", markFg: "#F4F1EA" },
  escuro: { bg: "#1C2733", ink: "#F4F1EA", note: "#A9A596", rule: "#34414F", brick: "#D9542B", markBg: "#F4F1EA", markFg: "#1C2733" },
};
const DEFAULT_THEME = "claro";

const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");
const fontCache = {};
function font(file) {
  if (!fontCache[file]) {
    const buf = fs.readFileSync(path.join(FONT_DIR, file));
    fontCache[file] = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return fontCache[file];
}
const fraunces = () => font("fraunces-latin-600-normal.woff");
const mono = () => font("ibm-plex-mono-latin-400-normal.woff");
const monoMedium = () => font("ibm-plex-mono-latin-500-normal.woff");
const sans = () => font("ibm-plex-sans-latin-400-normal.woff");

const MARGIN = 80;
const TEXT_WIDTH = WIDTH - MARGIN * 2;
const MAX_LINES = 3;
const TITLE_SIZES = [72, 64, 56];
const FALLBACK_TITLE = "Sem título";

const width = (f, text, size) => f.getAdvanceWidth(text, size);

/** Tira caracteres que a fonte não tem (emoji, símbolos) e normaliza espaços. */
function clean(text, f) {
  return Array.from(String(text ?? "").normalize("NFC"))
    .map((ch) => (/\s/.test(ch) ? " " : ch))
    .filter((ch) => ch === " " || f.charToGlyph(ch).index !== 0)
    .join("")
    .replace(/ +/g, " ")
    .trim();
}

/** Corta o texto para caber em maxWidth e termina com reticências. */
function ellipsize(text, f, size, maxWidth) {
  if (width(f, text, size) <= maxWidth) return text;
  let out = text.trimEnd();
  while (out.length > 1 && width(f, `${out}…`, size) > maxWidth) out = out.slice(0, -1).trimEnd();
  return `${out}…`;
}

/** Quebra por palavras (guloso). Palavra maior que a linha é cortada com reticências. */
function wrap(text, f, size, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (width(f, next, size) <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = width(f, word, size) <= maxWidth ? word : ellipsize(word, f, size, maxWidth);
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Escolhe o maior tamanho em que o título cabe em até 3 linhas; se nem no menor
 * cabe, usa o menor e termina a 3ª linha com reticências.
 */
function layoutTitle(rawTitle) {
  const f = fraunces();
  const title = clean(rawTitle, f) || FALLBACK_TITLE;
  for (const size of TITLE_SIZES) {
    const lines = wrap(title, f, size, TEXT_WIDTH);
    if (lines.length <= MAX_LINES) return { size, lines };
  }
  const size = TITLE_SIZES[TITLE_SIZES.length - 1];
  const lines = wrap(title, f, size, TEXT_WIDTH);
  const head = lines.slice(0, MAX_LINES - 1);
  const rest = lines.slice(MAX_LINES - 1).join(" ");
  return { size, lines: [...head, ellipsize(rest.endsWith("…") ? rest : `${rest}…`, f, size, TEXT_WIDTH)] };
}

const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

/** "27 NOV 2026", no fuso de Brasília (evita virar o dia perto da meia-noite UTC). */
function formatDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}`;
}

function pathEl(f, text, x, y, size, fill, letterSpacing = 0) {
  if (!text) return "";
  if (!letterSpacing) return `<path d="${f.getPath(text, x, y, size).toPathData(2)}" fill="${fill}"/>`;
  // espaçamento entre letras (rótulo mono): posiciona glifo a glifo
  let cx = x;
  const d = [];
  for (const ch of Array.from(text)) {
    d.push(f.getPath(ch, cx, y, size).toPathData(2));
    cx += f.getAdvanceWidth(ch, size) + letterSpacing;
  }
  return `<path d="${d.join(" ")}" fill="${fill}"/>`;
}

/** Marca "m.": quadrado com "m" em Fraunces e ponto tijolo. */
function markEl(x, y, s, t) {
  const f = fraunces();
  const size = s * 0.78;
  const mw = width(f, "m", size);
  const dot = s * 0.07;
  const baseline = y + s * 0.74;
  const left = x + (s - mw) / 2 - dot * 1.5;
  return [
    `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${(s * 0.14).toFixed(1)}" fill="${t.markBg}"/>`,
    pathEl(f, "m", left, baseline, size, t.markFg),
    `<circle cx="${(left + mw + dot * 2).toFixed(1)}" cy="${(baseline - dot).toFixed(1)}" r="${dot.toFixed(1)}" fill="${t.brick}"/>`,
  ].join("");
}

/**
 * Monta o SVG da capa.
 * @param {{ title: string, category?: string, label?: string, date?: Date|string, theme?: "claro"|"escuro" }} opts
 *   `label` (ex.: título do tema/cluster) tem prioridade sobre `category`.
 */
function buildCoverSvg({ title, category, label, date, theme } = {}) {
  const t = THEMES[theme] || THEMES[DEFAULT_THEME];
  const { size, lines } = layoutTitle(title);
  const lineHeight = Math.round(size * 1.14);

  const labelSize = 22;
  const spacing = labelSize * 0.1;
  const adv = (s) => Array.from(s).reduce((w, ch) => w + width(mono(), ch, labelSize) + spacing, 0);
  const upper = (s) => s.toLocaleUpperCase("pt-BR");
  const dateText = formatDate(date);
  const full = upper(clean(label || category || "", mono()));
  // o rótulo nunca passa da largura útil: corta a categoria, a data fica inteira
  const maxCat = TEXT_WIDTH - (dateText ? adv(` · ${dateText}`) : 0);
  let cat = full;
  while (cat.length > 1 && adv(cat) > maxCat) cat = cat.slice(0, -1);
  if (cat !== full) cat = `${cat.trimEnd().slice(0, -1)}…`;
  const labelText = [cat, dateText].filter(Boolean).join(" · ");

  const titleTop = 238;
  const body = [
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${t.bg}"/>`,
    markEl(MARGIN, 64, 52, t),
    pathEl(monoMedium(), "marck0101", MARGIN + 52 + 18, 64 + 34, 26, t.ink),
    // traço tijolo + rótulo
    `<rect x="${MARGIN}" y="168" width="64" height="6" fill="${t.brick}"/>`,
    pathEl(mono(), labelText, MARGIN, 214, labelSize, t.note, spacing),
    ...lines.map((l, i) => pathEl(fraunces(), l, MARGIN, titleTop + size * 0.9 + i * lineHeight, size, t.ink)),
    `<rect x="${MARGIN}" y="${HEIGHT - 84}" width="${TEXT_WIDTH}" height="1" fill="${t.rule}"/>`,
    pathEl(sans(), "Marcos Henrique · marketing medido", MARGIN, HEIGHT - 42, 22, t.note),
    pathEl(mono(), "blog.marck0101.com.br", WIDTH - MARGIN - width(mono(), "blog.marck0101.com.br", 20), HEIGHT - 42, 20, t.note),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${body.join("")}</svg>`;
}

/** PNG 1200x630 (as redes sociais não aceitam SVG em og:image). */
function renderCoverPng(opts) {
  return sharp(Buffer.from(buildCoverSvg(opts))).png({ compressionLevel: 9 }).toBuffer();
}

module.exports = { buildCoverSvg, renderCoverPng, layoutTitle, formatDate, THEMES, DEFAULT_THEME, WIDTH, HEIGHT };
