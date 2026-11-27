// Ritmo da receita do mês (R-COCKPIT-01). Função pura: só números.
//   esperado  = meta × dia / diasNoMês
//   projeção  = acumulado / dia × diasNoMês
//   status    = acumulado ÷ esperado: ≥100% no_caminho · 85–100% atencao · <85% fora
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1-12
}

const round1 = (n) => Math.round(n * 10) / 10;

function pacing({ accumulated, meta, day, daysInMonth: dim }) {
  const hasData = typeof accumulated === "number" && Number.isFinite(accumulated);
  const hasMeta = typeof meta === "number" && Number.isFinite(meta) && meta > 0;
  const validDay = Number.isInteger(day) && day >= 1 && day <= dim;
  const expected = hasMeta && validDay ? (meta * day) / dim : null;
  const projection = hasData && validDay ? (accumulated / day) * dim : null;
  let pctOfExpected = null;
  let status = "sem_dados";
  if (hasData && expected) {
    const ratio = accumulated / expected;
    pctOfExpected = round1(ratio * 100);
    status = ratio >= 1 ? "no_caminho" : ratio >= 0.85 ? "atencao" : "fora";
  }
  return {
    meta: hasMeta ? meta : null,
    accumulated: hasData ? accumulated : null,
    expected: expected === null ? null : Math.round(expected * 100) / 100,
    pctOfExpected,
    projection: projection === null ? null : Math.round(projection * 100) / 100,
    status,
  };
}

module.exports = { pacing, daysInMonth };
