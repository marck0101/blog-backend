/**
 * Datas do blog no fuso de Brasília (DUP-06).
 *
 * O servidor (Vercel) roda em UTC; quem usa o blog está no Brasil. Entre 21h e
 * meia-noite de Brasília já é "amanhã" em UTC, então qualquer conta de "hoje",
 * "este mês" ou "dia 15" feita com new Date(...).getDate() ou setHours() cai no
 * dia errado. Toda conta de dia/mês/ano passa por aqui.
 *
 * Vocabulário:
 *   dia ("day key") = texto "YYYY-MM-DD" de um dia em Brasília
 *   instante        = Date (um ponto no tempo, igual no mundo todo)
 */

const TZ = "America/Sao_Paulo";
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// en-CA já formata como YYYY-MM-DD
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** Dia (YYYY-MM-DD) em Brasília de um instante. Padrão: agora. */
function dayKey(date = new Date()) {
  return dayFormat.format(date);
}

/** "YYYY-MM-DD" válido (existe no calendário) ou null. Protege entrada de query string. */
function parseDayKey(value) {
  if (typeof value !== "string" || !DAY_KEY.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d ? value : null;
}

/** Diferença, em ms, entre o relógio de Brasília e o UTC num instante (ex.: -3 h) */
function offsetMs(instant) {
  const p = Object.fromEntries(partsFormat.formatToParts(instant).map(({ type, value }) => [type, Number(value)]));
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instante em que começa (00:00 em Brasília) o dia y-m-d. Aceita dia/mês fora do intervalo (32 de jan = 1º de fev). */
function startOfDayParts(y, m, d) {
  const utcMidnight = Date.UTC(y, m - 1, d);
  return new Date(utcMidnight - offsetMs(new Date(utcMidnight)));
}

/** Instante em que começa o dia "YYYY-MM-DD" em Brasília */
function startOfDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return startOfDayParts(y, m, d);
}

/** Último milissegundo do dia "YYYY-MM-DD" em Brasília */
function endOfDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(startOfDayParts(y, m, d + 1).getTime() - 1);
}

/** Dia "YYYY-MM-DD" somado de n dias (n pode ser negativo) */
function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Mês em Brasília que contém o instante, deslocado de `offset` meses: { start, end } */
function monthRange(date = new Date(), offset = 0) {
  const [y, m] = dayKey(date).split("-").map(Number);
  const start = startOfDayParts(y, m + offset, 1);
  const end = new Date(startOfDayParts(y, m + offset + 1, 1).getTime() - 1);
  return { start, end };
}

/** Ano inteiro em Brasília: { start, end } */
function yearRange(year) {
  return { start: startOfDayParts(year, 1, 1), end: new Date(startOfDayParts(year + 1, 1, 1).getTime() - 1) };
}

/**
 * Filtro de período dos formulários ("de" e "até", dias inteiros em Brasília)
 * para um campo de data do MongoDB. Valor inválido é ignorado. Sem nenhum: null.
 *   dayRangeFilter("2026-11-01", "2026-11-30") → { $gte: 01/11 00:00, $lte: 30/11 23:59:59.999 }
 */
function dayRangeFilter(from, to) {
  const fromKey = parseDayKey(from);
  const toKey = parseDayKey(to);
  if (!fromKey && !toKey) return null;
  const filter = {};
  if (fromKey) filter.$gte = startOfDay(fromKey);
  if (toKey) filter.$lte = endOfDay(toKey);
  return filter;
}

module.exports = {
  TZ,
  dayKey,
  parseDayKey,
  startOfDay,
  endOfDay,
  addDays,
  monthRange,
  yearRange,
  dayRangeFilter,
};
