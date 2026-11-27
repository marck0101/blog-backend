// Cockpit: o que cada fonte externa pode enviar. Lista fechada (whitelist):
// chave fora daqui é recusada, e nenhuma delas carrega dado de pessoa.
const SOURCES = ["prospect0101", "benchmark0101", "blog", "ga4", "gsc", "reports"];

// Fontes que enviam por HTTP (máquina a máquina), cada uma com o seu segredo
const INGEST_SECRET_ENV = {
  prospect0101: "COCKPIT_INGEST_SECRET_PROSPECT",
  benchmark0101: "COCKPIT_INGEST_SECRET_BENCHMARK",
  reports: "COCKPIT_INGEST_SECRET_REPORTS",
};

const ALLOWED_KEYS = {
  prospect0101: ["receita_mes", "contatos_semana", "respostas_semana", "reunioes_semana", "propostas_semana", "fechamentos_mes"],
  benchmark0101: ["analises_semana", "relatorios_gerados_semana", "leads_semana"],
  reports: ["relatorios_enviados_semana", "relatorios_falhos_semana"],
};

const MAX_ITEMS = 200;
const MAX_BODY_BYTES = 32 * 1024;
const TIMESTAMP_WINDOW_SEC = 5 * 60;
const MAX_REQUESTS_PER_MINUTE = 60;
const JOB_RUN_TTL_DAYS = 90;
const DEFAULT_META_MENSAL = 15000;

// Agendas esperadas de cada rotina (criadas na primeira leitura; editáveis no painel)
const DEFAULT_JOBS = [
  { job: "blog-cron-daily", label: "Rotina diária do blog", source: "blog", expectedEverySec: 86400, graceSec: 3600 },
  { job: "prospect-worker", label: "Prospecção (worker)", source: "prospect0101", expectedEverySec: 900, graceSec: 900 },
  { job: "benchmark-worker", label: "Benchmark (worker)", source: "benchmark0101", expectedEverySec: 3600, graceSec: 900 },
  { job: "reports-bot", label: "Relatórios (bot)", source: "reports", expectedEverySec: 86400, graceSec: 3600 },
];

module.exports = {
  SOURCES,
  INGEST_SECRET_ENV,
  ALLOWED_KEYS,
  MAX_ITEMS,
  MAX_BODY_BYTES,
  TIMESTAMP_WINDOW_SEC,
  MAX_REQUESTS_PER_MINUTE,
  JOB_RUN_TTL_DAYS,
  DEFAULT_META_MENSAL,
  DEFAULT_JOBS,
};

// ===== Placar semanal (C3) =====
// Números do placar. kind: "week" (retrato semanal da fonte), "month" (retrato do mês da
// semana), "blog" (conta direto no banco do blog). Rótulos fixos: nada vem de dado de pessoa.
const PLACAR_METRICS = [
  { key: "receita_mes", label: "Receita do mês (R$)", short: "Receita", unit: "brl", kind: "month", source: "prospect0101" },
  { key: "contatos_semana", label: "Contatos", short: "Contatos", unit: "n", kind: "week", source: "prospect0101" },
  { key: "respostas_semana", label: "Respostas", short: "Respostas", unit: "n", kind: "week", source: "prospect0101" },
  { key: "reunioes_semana", label: "Reuniões", short: "Reuniões", unit: "n", kind: "week", source: "prospect0101" },
  { key: "propostas_semana", label: "Propostas", short: "Propostas", unit: "n", kind: "week", source: "prospect0101" },
  { key: "fechamentos_mes", label: "Fechamentos do mês", short: "Fechamentos", unit: "n", kind: "month", source: "prospect0101" },
  { key: "analises_semana", label: "Análises do benchmark", short: "Análises", unit: "n", kind: "week", source: "benchmark0101" },
  { key: "posts_publicados", label: "Posts publicados", short: "Posts", unit: "n", kind: "blog", source: "blog" },
  { key: "inscritos_novos", label: "Inscritos novos", short: "Inscritos", unit: "n", kind: "blog", source: "blog" },
  { key: "leituras", label: "Leituras do blog", short: "Leituras", unit: "n", kind: "blog", source: "blog" },
];
const PLACAR_ON_TARGET_BAND = 0.1; // de 90% a 110% da meta = "na meta"
const PLACAR_WEEKS = 13;
const PLACAR_META_MAX = 100000000;

module.exports.PLACAR_METRICS = PLACAR_METRICS;
module.exports.PLACAR_ON_TARGET_BAND = PLACAR_ON_TARGET_BAND;
module.exports.PLACAR_WEEKS = PLACAR_WEEKS;
module.exports.PLACAR_META_MAX = PLACAR_META_MAX;
