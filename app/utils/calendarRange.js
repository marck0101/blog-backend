const { addDays, dayKey, endOfDay, monthRange, parseDayKey, startOfDay } = require("./dates");

// Período absurdo (anos) vira no máximo 1 ano a partir do início
const MAX_DAYS = 366;
// Folga em cada ponta: o painel agrupa pelo dia no fuso do navegador, que pode
// não ser o de Brasília; o front descarta o que cair fora da grade
const MARGIN_DAYS = 1;

/**
 * Intervalo do calendário do painel: { start, end } (instantes).
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD → semana ou período personalizado
 *   ?year=&month=                   → mês inteiro (formato antigo); sem nada, o mês atual
 */
function calendarRange(query = {}) {
  const from = parseDayKey(query.from);
  const to = parseDayKey(query.to);

  if (from && to && from <= to) {
    const limit = addDays(from, MAX_DAYS);
    const last = to > limit ? limit : to;
    return {
      start: startOfDay(addDays(from, -MARGIN_DAYS)),
      end: endOfDay(addDays(last, MARGIN_DAYS)),
    };
  }

  const [thisYear, thisMonth] = dayKey().split("-").map(Number);
  const year = parseInt(query.year) || thisYear;
  const month = parseInt(query.month) || thisMonth;
  const firstDay = parseDayKey(`${year}-${String(month).padStart(2, "0")}-01`) || dayKey();
  return monthRange(startOfDay(firstDay));
}

module.exports = { calendarRange };
