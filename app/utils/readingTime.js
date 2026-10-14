// Minutos de leitura de um HTML (~200 palavras/min, mínimo 1). Mesma conta do front.
function readingMinutes(html = "") {
  const text = String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// Troca `content` por `readingMinutes` (o leitor não precisa do texto na lista)
function withReadingMinutes(post) {
  const { content, ...rest } = post;
  return { ...rest, readingMinutes: readingMinutes(content) };
}

module.exports = { readingMinutes, withReadingMinutes };
