const escapeHtml = require("../utils/escapeHtml");

// Resumo diário de pendências para o admin (alerts.service). Títulos de post
// e mensagens de erro vêm do banco e de serviços externos: sempre escapados.
const COLORS = { erro: "#dc2626", "atenção": "#d97706" };

module.exports = function alertsEmail({ alerts, panelUrl }) {
  const rows = alerts
    .map(
      (a) => `
          <tr>
            <td style="padding:12px 0; border-bottom:1px solid #e5e7eb;">
              <span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:bold; color:#ffffff; background-color:${COLORS[a.level] || "#6b7280"};">${escapeHtml(a.level.toUpperCase())}</span>
              <strong style="margin-left:6px; font-size:15px; color:#111827;">${escapeHtml(a.title)}</strong>
              <p style="margin:6px 0 0; font-size:14px; color:#374151;">${escapeHtml(a.detail)}</p>
              ${a.url ? `<a href="${escapeHtml(a.url)}" style="font-size:13px; color:#2563eb;">Abrir no painel →</a>` : ""}
            </td>
          </tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6; font-family:Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:8px; overflow:hidden;">
          <tr>
            <td style="background-color:#111827; padding:24px 32px;">
              <span style="color:#ffffff; font-size:20px; font-weight:bold;">marck0101 · pendências do blog</span>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;">
              <p style="margin:0 0 8px; font-size:15px; color:#111827;">A rotina diária encontrou o que precisa da sua atenção:</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
              </table>
              <p style="margin:24px 0 0; font-size:13px; color:#6b7280;">Pendência não resolvida aparece de novo amanhã. <a href="${escapeHtml(panelUrl)}" style="color:#2563eb;">Abrir o painel</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
};
