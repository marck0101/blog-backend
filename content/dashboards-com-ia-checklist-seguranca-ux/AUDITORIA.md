# Auditoria: Dashboards com IA (publicado)

Revisão de 26/11/2026. Base: o HTML publicado (API pública). O `content.html` desta pasta é o publicado com as correções; vai para o banco pelo script da Sprint 3 (`--dry-run` primeiro).

**Achado principal:** o post não tinha **nenhuma referência nem link**, e fazia 8 afirmações técnicas e legais que pedem fonte. Também não tinha tags nem resposta direta.

## Afirmações e o que foi feito

| # | Trecho | Fonte acrescentada | Situação |
|---|---|---|---|
| 1 | Contraste mínimo de 4,5:1 (WCAG AA) | W3C, 2023 (critério 1.4.3) | Confere |
| 2 | Não depender só de cor | W3C, 2023 (critério 1.4.1) | Confere |
| 3 | Lovable usa Supabase; RLS em todas as tabelas | Lovable, 2026; Supabase, 2026 | Confere (integração oficial e documentação de RLS) |
| 4 | Senha com hash (bcrypt, argon2) | OWASP, Password Storage Cheat Sheet | Confere |
| 5 | Limite de tentativas contra força bruta | OWASP, Authentication Cheat Sheet | Confere |
| 6 | SQL injection | OWASP, SQL Injection Prevention Cheat Sheet | Confere |
| 7 | Incidente relevante: comunicar ANPD e titulares | LGPD (Brasil, 2018) e Resolução CD/ANPD 15/2024 | Confere; acrescentado o prazo de 3 dias úteis, como no post do caso Binance |
| 8 | robots.txt e noindex não são segurança | Google Search Central (robots.txt e robots meta tag) | Confere; a frase agora cita a própria documentação do Google |
| 9 | "Página sem política de privacidade (...) pode ter anúncio reprovado" | Não encontrada na ajuda do Índice de Qualidade | **Reescrito:** "a experiência na página de destino é um dos componentes do Índice de Qualidade (Google, 2026a)". A reprovação por falta de política não foi confirmada e saiu |
| 10 | Relato do sistema no Lovable avaliado por um professor | Experiência do autor | Mantido (relato, não dado) |

11 referências novas, 10 com link.

## Links

- 0 → 13 links (10 referências + 3 internos: Cliente não compra tecnologia, caso Binance, Blog rápido e seguro). A limpeza da API mantém os 13.
- **Redundância:** a seção 3 (storytelling) cobre o mesmo assunto de "Cliente não compra tecnologia", que vai mais fundo. Ficou uma frase com link para ele; este post fica dono do checklist técnico (segurança, acesso, validação).

## SEO

- `cluster: dashboards-e-bi`, `tags` (5) e `directAnswer` no post.json. FAQ (4) já existia.
- Candidato a pilar do tema? Não: o pilar de Dashboards e BI é o post novo da Sprint 4 (seminário GH). Este é o "para aprofundar" técnico.
