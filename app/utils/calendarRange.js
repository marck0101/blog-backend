// Intervalo do calendário do painel: ?from=YYYY-MM-DD&to=YYYY-MM-DD (semana ou
// período personalizado) ou ?year=&month= (mês, formato antigo).
// Folga de 1 dia em cada ponta: o servidor roda em UTC e o painel agrupa pelo dia
// no fuso do navegador; o front descarta o que cair fora da grade.
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 366;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function calendarRange(query) {
  const { from, to } = query;
  if (typeof from === "string" && typeof to === "string" && ISO_DAY.test(from) && ISO_DAY.test(to)) {
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T23:59:59.999Z`);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end) {
      // Período absurdo (anos) vira no máximo 1 ano a partir do início
      const capped = end - start > MAX_DAYS * DAY_MS ? new Date(start.getTime() + MAX_DAYS * DAY_MS) : end;
      return { start: new Date(start.getTime() - DAY_MS), end: new Date(capped.getTime() + DAY_MS) };
    }
  }

  const year = parseInt(query.year) || new Date().getFullYear();
  const month = parseInt(query.month) || new Date().getMonth() + 1;
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 0, 23, 59, 59, 999),
  };
}

module.exports = { calendarRange };
