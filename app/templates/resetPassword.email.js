module.exports = function resetPasswordEmail({ userName, resetUrl }) {
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
              <span style="color:#ffffff; font-size:20px; font-weight:bold;">marck0101</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px; font-size:16px; color:#111827;">Olá, ${userName || "admin"}!</p>
              <p style="margin:0 0 24px; font-size:16px; color:#111827;">Recebemos uma solicitação para redefinir a senha do painel administrativo. Clique no botão abaixo para criar uma nova senha:</p>

              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:8px; background-color:#2563eb;">
                    <a href="${resetUrl}" style="display:inline-block; padding:14px 28px; font-size:16px; color:#ffffff; text-decoration:none; font-weight:bold;">Redefinir senha →</a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0; font-size:13px; color:#6b7280;">Este link expira em 1 hora. Se você não solicitou isso, pode ignorar este email com segurança.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px; background-color:#f9fafb;">
              <p style="margin:0; font-size:12px; color:#9ca3af;">marck0101 — painel administrativo</p>
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
