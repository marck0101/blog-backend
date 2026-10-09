const escapeHtml = require("../utils/escapeHtml");

// `content` é HTML gerado pelo editor do admin, por isso entra sem escape.
module.exports = function campaignEmail({
  subscriberName,
  subject,
  preheader,
  content,
  isMemberContent,
  postUrl,
  unsubscribeUrl,
}) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
  <style>
    .content img { max-width: 100% !important; height: auto !important; }
    .content a { color: #2563eb; }
    .content blockquote { margin: 16px 0; padding-left: 16px; border-left: 3px solid #e5e7eb; color: #4b5563; }
    .content pre { background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6; font-family:Arial, Helvetica, sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(preheader || "")}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:8px; overflow:hidden;">
          <tr>
            <td style="background-color:#111827; padding:24px 32px;">
              <span style="color:#ffffff; font-size:20px; font-weight:bold;">marck0101</span>
              ${
                isMemberContent
                  ? `<span style="margin-left:12px; padding:3px 10px; border-radius:999px; background-color:#f59e0b; color:#111827; font-size:11px; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px;">Exclusivo para membros</span>`
                  : ""
              }
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px; font-size:16px; color:#111827;">Olá, ${escapeHtml(subscriberName || "leitor")}!</p>
              <div class="content" style="font-size:16px; line-height:1.6; color:#111827;">
                ${content}
              </div>
              ${
                postUrl
                  ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                <tr>
                  <td style="border-radius:8px; background-color:#2563eb;">
                    <a href="${escapeHtml(postUrl)}" style="display:inline-block; padding:14px 28px; font-size:16px; color:#ffffff; text-decoration:none; font-weight:bold;">Continuar lendo no blog →</a>
                  </td>
                </tr>
              </table>`
                  : ""
              }
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px; background-color:#f9fafb;">
              <p style="margin:0 0 8px; font-size:12px; color:#9ca3af;">
                ${
                  isMemberContent
                    ? "Você recebe este email porque é membro do blog marck0101. Por favor, não encaminhe."
                    : "Você recebe este email porque se inscreveu no blog marck0101."
                }
              </p>
              <a href="${unsubscribeUrl}" style="font-size:12px; color:#9ca3af; text-decoration:underline;">Cancelar inscrição</a>
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
