# Changelog

Formato livre, mais recente primeiro. Mudança de regra de negócio também vai em `docs/SISTEMA.md`.

## 27/11/2026 · Sprint R6 · Capa automática

- Novo: `GET /api/posts/slug/:slug/cover.png?tema=claro|escuro` gera a capa 1200x630 no padrão Relatório (temas claro e escuro) para posts sem capa própria. Post com `coverImage` é redirecionado para a capa dele, nunca sobrescrito.
- Novo: serviço `coverCard.service.js` (texto em caminhos vetoriais com opentype.js, PNG pelo sharp) e fontes da marca em `app/assets/fonts`.
- Novo: `scripts/gen-cover-samples.js` para gerar amostras.
- `vercel.json`: `includeFiles` para empacotar as fontes.
- Decisões e uso: `docs/CAPAS.md`.
