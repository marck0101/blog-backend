// Horário da rotina diária (publica agendados, retoma envios, manda alertas).
// Precisa bater com "crons" do vercel.json: tests/config/schedule.test.mjs confere.
// 12h UTC = 9h em Brasília.
const DAILY_JOB_UTC_HOUR = 12;

module.exports = { DAILY_JOB_UTC_HOUR };
