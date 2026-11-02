const BlogPost = require("../models/blogpost.model");
const Campaign = require("../models/campaign.model");
const transporter = require("../config/mailer");
const alertsEmail = require("../templates/alerts.email");
const { getStatus: linkedinStatus } = require("./linkedin.service");
const { FRONTEND_URL } = require("../config/urls");

/**
 * Alertas da rotina diária (SEC-07): o que precisa de ação e hoje só aparece
 * abrindo o painel ou os logs. Vira um email para o admin, só quando há algo.
 * Pendência que continua sem solução volta no email do dia seguinte.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
// Reconectar o LinkedIn antes de expirar (a conexão dura 60 dias, sem renovação)
const LINKEDIN_WARN_DAYS = 7;

const panel = (path) => `${FRONTEND_URL}${path}`;

/** [{ level: "erro" | "atenção", title, detail, url }] */
async function collectAlerts(summary = {}, now = new Date()) {
  const alerts = [];
  const add = (level, title, detail, url) => alerts.push({ level, title, detail, url });

  // 1. Erros da própria rotina (publicar, email, LinkedIn, retomar envio)
  for (const error of summary.errors || []) add("erro", "Falha na rotina diária", error, panel("/admin"));

  const [overdue, failedCampaigns, stuckCampaigns, unsentNotices, linkedinFailed] = await Promise.all([
    // 2. Agendado com data passada que continua fora do ar
    BlogPost.find({ status: "planned", deletedAt: null, plannedAt: { $lte: now } }).select("_id title").lean(),
    // 3. Envios terminados nas últimas 24h com falha
    Campaign.find({ status: "sent", sentAt: { $gte: new Date(now - DAY_MS) }, "recipients.status": "failed" })
      .select("_id subject recipients.status")
      .lean(),
    // 4. Envio que continua "enviando" depois da retomada
    Campaign.find({ status: "sending" }).select("_id subject").lean(),
    // 5. Aviso de post publicado que ficou como rascunho (R-EMAIL-03: não sai sozinho)
    Campaign.find({ kind: "post-notification", status: "draft" }).select("_id subject post").lean(),
    // 6. LinkedIn de artigo publicado que falhou
    BlogPost.find({ published: true, deletedAt: null, "linkedin.enabled": true, "linkedin.status": "failed" })
      .select("_id title linkedin.error")
      .lean(),
  ]);

  for (const p of overdue) {
    add("erro", "Agendado não foi ao ar", `"${p.title}" passou da data e continua agendado.`, panel(`/admin/posts/${p._id}`));
  }
  for (const c of failedCampaigns) {
    const failed = c.recipients.filter((r) => r.status === "failed").length;
    add("erro", "Envio com falhas", `"${c.subject}": ${failed} de ${c.recipients.length} não receberam.`, panel(`/admin/campaigns/${c._id}`));
  }
  for (const c of stuckCampaigns) {
    add("atenção", "Envio parado", `"${c.subject}" continua enviando. Abra e continue o envio.`, panel(`/admin/campaigns/${c._id}`));
  }

  const noticePosts = await BlogPost.find({
    _id: { $in: unsentNotices.map((c) => c.post).filter(Boolean) },
    published: true,
    deletedAt: null,
  })
    .select("_id")
    .lean();
  const published = new Set(noticePosts.map((p) => String(p._id)));
  for (const c of unsentNotices.filter((c) => published.has(String(c.post)))) {
    add("atenção", "Aviso de post não enviado", `"${c.subject}" está em rascunho (público vazio ou email sem configuração na publicação).`, panel(`/admin/campaigns/${c._id}`));
  }

  for (const p of linkedinFailed) {
    add("erro", "LinkedIn falhou", `"${p.title}": ${p.linkedin?.error || "sem detalhe"}`, panel(`/admin/posts/${p._id}`));
  }

  // 7. Conexão do LinkedIn: expirada (com post esperando) ou perto de expirar
  const li = await linkedinStatus();
  if (li.connected && li.daysLeft <= LINKEDIN_WARN_DAYS) {
    add("atenção", "LinkedIn expira em breve", `A conexão vence em ${li.daysLeft} dia(s). Reconecte pelo editor de qualquer post.`, panel("/admin/posts"));
  } else if (!li.connected) {
    const waiting = await BlogPost.countDocuments({
      deletedAt: null,
      status: { $in: ["planned", "published"] },
      "linkedin.enabled": true,
      "linkedin.status": { $in: ["idle", null] },
    });
    if (waiting > 0) {
      add("erro", li.expired ? "LinkedIn expirado" : "LinkedIn desconectado", `${waiting} post(s) com LinkedIn ligado não vão sair no LinkedIn até reconectar.`, panel("/admin/posts"));
    }
  }

  return alerts;
}

const recipient = () => process.env.ADMIN_EMAIL || process.env.GMAIL_USER;

/** Manda o resumo se houver alerta e email configurado. Devolve true se enviou. */
async function sendAlerts(alerts) {
  if (!alerts.length || !process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD || !recipient()) return false;
  const errors = alerts.filter((a) => a.level === "erro").length;
  await transporter.sendMail({
    from: `"marck0101 · alertas" <${process.env.GMAIL_USER}>`,
    to: recipient(),
    subject: `[Blog] ${alerts.length} pendência(s)${errors ? `, ${errors} erro(s)` : ""}`,
    html: alertsEmail({ alerts, panelUrl: panel("/admin") }),
  });
  return true;
}

module.exports = { collectAlerts, sendAlerts, LINKEDIN_WARN_DAYS };
