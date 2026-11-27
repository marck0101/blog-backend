const { z } = require("zod");
const { MAX_ITEMS, ALLOWED_KEYS, SOURCES, PLACAR_METRICS, PLACAR_META_MAX } = require("../config/cockpit");
const { parseDayKey } = require("../utils/dates");
const { AREAS, STATUSES, DECISIONS, LINK_GROUPS } = require("../config/cockpitExperiments");

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEK = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const period = z.string().refine((p) => MONTH.test(p) || WEEK.test(p) || parseDayKey(p), { error: "period: use 2026-11, 2026-W48 ou 2026-11-27" });

// meta: pequeno e raso (até 5 chaves; texto curto, número ou boolean)
const meta = z
  .record(z.string().regex(/^[a-z_]{1,30}$/), z.union([z.string().max(40), z.number().finite(), z.boolean()]))
  .refine((o) => Object.keys(o).length <= 5, { error: "meta: no máximo 5 campos" });

const item = z
  .object({
    key: z.string().max(60),
    period,
    value: z.number().finite().nullable(),
    meta: meta.optional(),
  })
  .strict();

const ingestBody = z.object({ items: z.array(item).min(1).max(MAX_ITEMS) }).strict();

// Chaves permitidas da fonte (whitelist): devolve a primeira fora da lista ou null
function firstForbiddenKey(source, items) {
  const allowed = ALLOWED_KEYS[source] || [];
  return items.find((i) => !allowed.includes(i.key))?.key ?? null;
}

const heartbeatBody = z
  .object({
    status: z.enum(["start", "ok", "fail"]),
    durationMs: z.number().int().min(0).max(86400000).optional(),
    items: z.number().int().min(0).max(10000000).optional(),
    error: z.string().max(500).optional(),
  })
  .strict();

const jobName = z.string().regex(/^[a-z0-9-]{1,40}$/);
const jobParams = z.object({ job: jobName });

const jobCreateBody = z
  .object({
    job: jobName,
    label: z.string().min(1).max(80),
    source: z.enum(SOURCES).nullable().optional(),
    expectedEverySec: z.number().int().min(60).max(31 * 86400),
    graceSec: z.number().int().min(0).max(31 * 86400).optional(),
  })
  .strict();

const jobUpdateBody = jobCreateBody
  .omit({ job: true })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: "Nenhum campo informado" });

const placarKeys = PLACAR_METRICS.map((m) => m.key);
// Meta semanal por número; null apaga a meta. Chave fora da lista fechada é recusada.
const placarMetasBody = z
  .object({
    metas: z
      .record(z.string(), z.number().min(0).max(PLACAR_META_MAX).nullable())
      .refine((o) => Object.keys(o).length > 0 && Object.keys(o).every((k) => placarKeys.includes(k)), { error: "Número desconhecido" }),
  })
  .strict();

const metaBody = z.object({ valor: z.number().min(0).max(100000000) }).strict();

// ===== Experimentos =====
const objectId = z.string().regex(/^[a-f\d]{24}$/i, { error: "Identificador inválido" });
const idParams = z.object({ id: objectId });

const text = (max) => z.string().trim().max(max);
const score = z.number().int().min(1).max(5);
const dateField = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { error: "Data inválida" })
  .transform((v) => new Date(v));

// "Se … então … porque …"
const HYPOTHESIS = /\bse\b[\s\S]+\bent[aã]o\b[\s\S]+\bporque\b[\s\S]+/i;

const variant = z.object({ name: text(60).min(1), description: text(400).optional() }).strict();
const resultPatch = z
  .object({
    summary: text(1000),
    valueA: z.number().finite().nullable(),
    valueB: z.number().finite().nullable(),
    sample: z.number().int().min(0).nullable(),
    decision: z.enum(DECISIONS).nullable(),
    learning: text(1000),
  })
  .partial()
  .strict();

const experimentCreateBody = z
  .object({
    title: text(120).min(3),
    hypothesis: text(600).regex(HYPOTHESIS, { error: 'hypothesis: use o formato "Se … então … porque …"' }),
    area: z.enum(AREAS),
    channel: text(80).optional(),
    metric: text(120).optional(),
    guardrailMetric: text(120).optional(),
    ice: z.object({ impact: score, confidence: score, ease: score }).strict(),
    minSample: z.number().int().min(0).nullable().optional(),
    plannedEnd: dateField.nullable().optional(),
    variants: z.array(variant).max(6).optional(),
    result: resultPatch.optional(),
  })
  .strict();

const experimentUpdateBody = experimentCreateBody
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: "Nenhum campo informado" });

const experimentTransitionBody = z.object({ status: z.enum(STATUSES), result: resultPatch.optional() }).strict();

const experimentListQuery = z.object({ status: z.enum(STATUSES).optional(), area: z.enum(AREAS).optional() });

// ===== Links =====
// Só https: nada de javascript:, data:, http: ou endereço sem protocolo
const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (v) => {
      try {
        const u = new URL(v);
        return u.protocol === "https:" && Boolean(u.hostname) && !u.username && !u.password;
      } catch {
        return false;
      }
    },
    { error: "url: use um endereço https:// válido" }
  );

const linkCreateBody = z
  .object({
    label: text(80).min(1),
    url: httpsUrl,
    group: z.enum(LINK_GROUPS).optional(),
    note: text(300).optional(),
    order: z.number().int().min(0).max(100000).optional(),
  })
  .strict();
const linkUpdateBody = linkCreateBody.partial().refine((b) => Object.keys(b).length > 0, { error: "Nenhum campo informado" });

module.exports = {
  ingestBody,
  heartbeatBody,
  firstForbiddenKey,
  jobParams,
  jobCreateBody,
  jobUpdateBody,
  metaBody,
  placarMetasBody,
  idParams,
  experimentCreateBody,
  experimentUpdateBody,
  experimentTransitionBody,
  experimentListQuery,
  linkCreateBody,
  linkUpdateBody,
};
