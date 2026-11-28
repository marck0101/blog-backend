# Changelog

Formato livre, mais recente primeiro. Mudança de regra de negócio também vai em `docs/SISTEMA.md`.

## 28/11/2026 · Correção · validação da query no Express 5

- Corrigido: `validate({ query })` não trocava `req.query` (no Express 5 é só leitura), então padrão, conversão e descarte de campo extra nunca chegavam ao controller; agora chegam. R-API-02 passa a valer para a query.
- Esquemas de lista de assinantes e de envios ganham `sort` (senão a ordenação seria descartada).
- Testes: padrão/número/campo extra na query, params e body, ordenação das listas.
 · Placar do conteúdo

- Novo: Placar com `aberturas_email` e `cliques_email` (pessoas distintas por envio na semana, sem robôs), meta semanal editável como os demais. Agora são 12 números.
- Decisão: pedido de pré-diagnóstico não é guardado no backend (WhatsApp/e-mail); a origem vai só como `[ref: blog-<slug>]` na mensagem e `origin_path` no GA4. Ver `docs/SISTEMA.md` §24.
- Testes: contagem sem robôs/duplicados/fora da semana, metas, 401 sem login.

## 27/11/2026 · Sprint R5 · Experimentos no site

- Novo: `GET /api/experiments/ativos` (público, cache de 60s) com os experimentos rodando que têm alvo e variantes (`chave`, `alvo`, `variantes`), sem nenhum campo interno.
- Experimento ganha `chave`, `alvo` (`pre-diagnostico-cta`) e `variantes` (2 a 4 textos); os três juntos, chave única, um rodando por alvo.
- Testes: validação, só rodando listados, sem vazamento de campos, lista vazia.
## 27/11/2026 · Sprints C5 e C3 · Automações e Placar semanal

- Novo: `GET /api/cockpit/automacoes` (estado e 10 últimas execuções por rotina, com `nunca_rodou`).
- Novo: `GET /api/cockpit/placar` e `PUT /api/cockpit/placar/metas` (10 números, 13 semanas segunda a domingo em Brasília, metas semanais em `SiteSettings`).
- Novo: resumo da manhã no Telegram dentro de `/api/cron/daily` (variáveis `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; sem elas, "não configurado"). Só números agregados.
- Testes: bordas do prazo das rotinas, semanas (virada de ano e fuso), metas, texto sem dado pessoal, envio sem configuração.

## 27/11/2026 · Sprint R6 · Capa automática

- Novo: `GET /api/posts/slug/:slug/cover.png?tema=claro|escuro` gera a capa 1200x630 no padrão Relatório (temas claro e escuro) para posts sem capa própria. Post com `coverImage` é redirecionado para a capa dele, nunca sobrescrito.
- Novo: serviço `coverCard.service.js` (texto em caminhos vetoriais com opentype.js, PNG pelo sharp) e fontes da marca em `app/assets/fonts`.
- Novo: `scripts/gen-cover-samples.js` para gerar amostras.
- `vercel.json`: `includeFiles` para empacotar as fontes.
- Decisões e uso: `docs/CAPAS.md`.
