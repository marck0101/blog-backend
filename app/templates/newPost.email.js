module.exports = function newPostEmail({ subscriberName, postTitle, postSummary, postUrl, unsubscribeUrl }) {
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
              <p style="margin:0 0 16px; font-size:16px; color:#111827;">Olá, ${subscriberName || "leitor"}!</p>
              <p style="margin:0 0 24px; font-size:16px; color:#111827;">Acabei de publicar um novo artigo que pode te interessar:</p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e7eb; border-bottom:1px solid #e5e7eb; padding:20px 0; margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 0;">
                    <p style="margin:0 0 8px; font-size:22px; font-weight:bold; color:#111827;">${postTitle}</p>
                    <p style="margin:0; font-size:15px; color:#6b7280;">${postSummary || ""}</p>
                  </td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:8px; background-color:#2563eb;">
                    <a href="${postUrl}" style="display:inline-block; padding:14px 28px; font-size:16px; color:#ffffff; text-decoration:none; font-weight:bold;">Ler artigo completo →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px; background-color:#f9fafb;">
              <p style="margin:0 0 8px; font-size:12px; color:#9ca3af;">Você recebe este email porque se inscreveu no blog marck0101.</p>
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
