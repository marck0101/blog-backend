/**
 * Semanas do Cockpit: segunda a domingo no fuso de Brasília (mesma conta da
 * semana ISO 8601, então "2026-W48" combina com o que os outros sistemas enviam).
 */
const { dayKey, addDays, startOfDay, endOfDay } = require("./dates");

function utcDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Segunda-feira (dia "YYYY-MM-DD") da semana que contém o dia */
function mondayOf(key) {
  const dow = (utcDate(key).getUTCDay() + 6) % 7; // segunda = 0
  return addDays(key, -dow);
}

/** Chave ISO da semana ("2026-W48") de um dia. A semana pertence ao ano da sua quinta-feira. */
function weekKeyOf(key) {
  const thursday = addDays(mondayOf(key), 3);
  const year = Number(thursday.slice(0, 4));
  const dayOfYear = Math.round((utcDate(thursday) - Date.UTC(year, 0, 1)) / 86400000) + 1;
  return `${year}-W${String(Math.floor((dayOfYear - 1) / 7) + 1).padStart(2, "0")}`;
}

/** Últimas `count` semanas (da mais antiga à atual) com limites em instantes de Brasília */
function lastWeeks(now = new Date(), count = 13) {
  const currentMonday = mondayOf(dayKey(now));
  const weeks = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = addDays(currentMonday, -7 * i);
    const end = addDays(start, 6);
    weeks.push({
      key: weekKeyOf(start),
      start,
      end,
      startAt: startOfDay(start),
      endAt: endOfDay(end),
      month: end.slice(0, 7),
      current: i === 0,
    });
  }
  return weeks;
}

module.exports = { mondayOf, weekKeyOf, lastWeeks };
