const { z } = require("zod");
const { MAX_ITEMS, ALLOWED_KEYS, SOURCES } = require("../config/cockpit");
const { parseDayKey } = require("../utils/dates");

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

const metaBody = z.object({ valor: z.number().min(0).max(100000000) }).strict();

module.exports = { ingestBody, heartbeatBody, firstForbiddenKey, jobParams, jobCreateBody, jobUpdateBody, metaBody };
