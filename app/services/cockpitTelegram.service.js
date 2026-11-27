/**
 * Resumo da manhã no Telegram (Bot API). Só números agregados e rótulos fixos:
 * nenhum nome, e-mail, telefone ou texto vindo de fora entra na mensagem.
 * Sem TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID nada é enviado. O bot só fala com o
 * chat configurado e nunca responde a outro (chatAllowed).
 */
const { looksLikePii } = require("../utils/cockpitSecurity");
const { PLACAR_METRICS } = require("../config/cockpit");

const STATUS_TEXT = { abaixo: "abaixo da meta", na_meta: "na meta", acima: "acima da meta", sem_meta: "sem meta", sem_dados: "sem dado" };

function telegramConfig(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  return token && chatId ? { token, chatId: String(chatId) } : null;
}

// Mensagem vinda de outro chat (webhook): recusada
function chatAllowed(chatId, env = process.env) {
  const cfg = telegramConfig(env);
  return Boolean(cfg) && String(chatId) === cfg.chatId;
}

const fmt = (n, unit) => (unit === "brl" ? `R$ ${Math.round(n).toLocaleString("pt-BR")}` : String(Math.round(n * 10) / 10));

/** Texto curto: números da semana atual contra a meta + contagem de pendências. Só número e rótulo fixo. */
function buildMorningText({ placar, pendencias = 0 }) {
  const lines = ["Bom dia. Placar da semana (parcial):"];
  for (const n of placar.numeros) {
    const m = PLACAR_METRICS.find((x) => x.key === n.key);
    if (!m || !n.current || !Number.isFinite(n.current.value)) continue;
    const meta = n.meta ? ` de ${fmt(n.meta, m.unit)}` : "";
    lines.push(`- ${m.short}: ${fmt(n.current.value, m.unit)}${meta} (${STATUS_TEXT[n.current.status] || "sem dado"})`);
  }
  if (lines.length === 1) lines.push("- Ainda sem números nesta semana.");
  lines.push(pendencias > 0 ? `Pendências no painel: ${pendencias}.` : "Sem pendências no painel.");
  return lines.join("\n");
}

/** Envia o texto. Devolve "enviado" | "não configurado" | "bloqueado" | "falhou". Nunca lança. */
async function sendMorningSummary(text, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const cfg = telegramConfig(env);
  if (!cfg) {
    console.log("[cockpit] Telegram: não configurado");
    return "não configurado";
  }
  if (looksLikePii(text)) return "bloqueado"; // última barreira: parece dado de pessoa
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? "enviado" : "falhou";
  } catch {
    // não registra a mensagem de erro: pode conter a URL com o token
    console.error("[cockpit] Telegram: envio falhou");
    return "falhou";
  }
}

module.exports = { telegramConfig, chatAllowed, buildMorningText, sendMorningSummary };
