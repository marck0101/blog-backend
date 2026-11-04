# Backlog técnico — Blog marck0101

> Criado em 02/11/2026 a partir da análise do código (ver [SISTEMA.md](SISTEMA.md)).
> Ordem de prioridade: **1. Segurança → 2. Duplicatas → 3. Testes e validadores → 4. Regras
> de negócio**. Dentro de cada fase, de cima para baixo.

## Como usar

- Cada tarefa tem um código (`SEC-01`, `DUP-03`…), o repositório afetado, o tamanho
  (**P** até meio dia · **M** 1–2 dias · **G** 3+ dias) e um **critério de pronto**.
- Uma tarefa = uma branch = um PR (`fix/sec-01-sanitizar-html`, `refactor/dup-02-avisos`…).
- Regras citadas (`R-POST-09`…) estão descritas no SISTEMA.md. Se a tarefa muda uma regra,
  o SISTEMA.md é atualizado no mesmo PR.
- Ao concluir: marcar `[x]`, anotar o PR e a data.

## Por que existe uma fase 0

A prioridade é segurança, mas corrigir segurança sem teste deixa a correção sem garantia
(alguém desfaz sem perceber numa refatoração). Por isso a **fase 0 só monta a estrutura de
testes** (pequena, sem escrever a suíte inteira). A partir dela, **toda tarefa das fases 1 e
2 entrega o próprio teste**. A fase 3 cobre o que sobrar.

---

## Fase 0 — Fundação de testes (pré-requisito)

- [x] **TEST-00 · Estrutura de testes no backend** · `blog-backend` · P — concluída em 02/11/2026 (branch `test/test-00-estrutura`)
  - Vitest + Supertest + `mongodb-memory-server` (banco em memória, nunca toca DEV/PROD).
  - `app/app.js` já exporta o Express sem `listen`: dá para testar as rotas direto.
  - Helpers: criar admin com sessão válida (cookie + 2FA), criar post/assinante, e mocks de
    `transporter.sendMail` e `fetch` (LinkedIn) — **nenhum teste envia email ou posta de verdade**.
  - Script `npm test` real (substitui o placeholder).
  - **Pronto quando:** `npm test` roda um teste de fumaça (`GET /api/health` = 200) e um de
    rota protegida (`GET /api/posts` sem sessão = 401).

- [x] **TEST-01 · Estrutura de testes no front** · `blog-front` · P — concluída em 02/11/2026 (branch `test/test-01-estrutura` no blog-front; Testing Library entra com a TEST-07, quando houver teste de componente)
  - Vitest + Testing Library (jsdom). Já usa Vite: configuração mínima.
  - **Pronto quando:** `npm test` roda um teste de `utils/postStatus.js`.

- [x] **CI-01 · Testes em todo push/PR** · os dois · P — concluída em 02/11/2026 (branches `ci/ci-01-testes`; `.github/workflows/ci.yml`. Backend: testes + audit de produção nível alto. Front: testes + build + audit nível crítico; lint roda sem bloquear até zerar os 19 erros antigos). **Só passa a rodar depois do push para o GitHub.**
  - GitHub Actions: `npm ci`, `npm run lint` (front), `npm test`, `npm audit --audit-level=high`.
  - ⚠️ O front tem **19 erros de lint antigos** (ex.: `setState` dentro de `useEffect` em
    `pages/Blog/Post.jsx`). Ou corrigir antes, ou o lint entra só como aviso até zerar.
  - **Pronto quando:** PR com teste falhando aparece vermelho no GitHub.

---

## Fase 1 — Segurança

- [x] **SEC-01 · Sanitizar o HTML dos posts e envios** · os dois · M — concluída em 02/11/2026 (branches `fix/sec-01-sanitizar-html` nos dois repositórios; banco DEV: 133 posts, 0 com risco, 17 com diferença só de formatação e nenhuma tag perdida. **Falta rodar em produção:** `node scripts/sanitize-content.js --prod` e, se listar risco, `--prod --apply`)
  - Hoje o conteúdo é exibido com `dangerouslySetInnerHTML` sem filtro (`pages/Blog/Post.jsx`,
    prévias, histórico, lixeira, `CampaignEditor`). Só o admin escreve, mas uma conta
    comprometida ou um HTML importado com `<script>` vira ataque a todos os leitores.
  - Backend: sanitizar `content` ao salvar post e envio (`sanitize-html` com lista de tags
    e atributos permitidos do TipTap: títulos, listas, links, imagens, alinhamento).
    Aplicar também em `scripts/import-*.js`.
  - Front: DOMPurify na renderização (defesa em profundidade).
  - Script único para sanitizar os posts já existentes (com `--apply`, como os imports).
  - **Pronto quando:** teste prova que `<script>`, `onerror=`, `javascript:` e `<iframe>`
    são removidos e que a formatação normal (negrito, link, imagem, tabela) continua.

- [ ] **SEC-02 · CSP com `script-src` no site** · `blog-front` · M · depende de SEC-01 — 🔎 **em observação desde 02/11/2026** (branches `fix/sec-02-csp`): política completa em modo só-relatório, dados do prerender viraram blocos JSON (sem script inline) e relatórios chegam aos logs do backend como `[CSP]`. **Passo que falta:** depois de 1 semana em produção, ler os `[CSP]` da Vercel, ajustar domínios se preciso e trocar `Content-Security-Policy-Report-Only` por `Content-Security-Policy`, mantendo o `report-uri`
  - Hoje a CSP só tem `frame-ancestors`, `object-src` e `base-uri`. Liberar só os domínios
    usados: próprio site, GA4, Clarity, Meta Pixel, Firebase.
  - Começar com `Content-Security-Policy-Report-Only` por 1 semana, ler o console, depois
    aplicar.
  - **Pronto quando:** site, painel, login Google e análises funcionam com a CSP ativa.

- [x] **SEC-03 · Cancelamento de inscrição seguro** · os dois · M — concluída em 02/11/2026 (branches `fix/sec-03-cancelamento-inscricao` nos dois repositórios; de quebra, o leitor deixa de ver o JSON cru da API ao cancelar). ⚠️ **Deploy: front antes do backend** — o backend novo redireciona para `/cancelar-inscricao`, que só existe no front novo
  - Hoje um GET cancela direto: antivírus de email que abrem links descadastram pessoas.
  - GET → página no blog "Confirmar cancelamento" (botão). Cancelamento só por POST.
  - Cabeçalhos `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
    (RFC 8058, exigido por Gmail/Yahoo para remetentes em volume) apontando para o POST.
  - Links de emails antigos (GET) continuam funcionando, levando à página de confirmação.
  - Mantém R-SUB-06 (idempotente) e R-EMAIL-12 (atribuição ao envio).
  - **Pronto quando:** teste prova que GET não altera o assinante e POST altera.

- [x] **SEC-04 · Exclusão definitiva só da lixeira, sem órfãos** · `blog-backend` · P — concluída em 02/11/2026 (branch `fix/sec-04-exclusao-definitiva`; testes em `tests/posts/trash.test.mjs`)
  - `DELETE /api/posts/:id/hard` não confere se o post está na lixeira (só o painel garante).
  - Exigir `deletedAt != null`; apagar junto comentários e `PostDailyStat` do post.
    Envios ligados ao post ficam (são histórico), com `post: null`.
  - **Pronto quando:** teste prova 409 para post fora da lixeira e ausência de órfãos.

- [x] **SEC-05 · Tipos de entrada nas rotas do painel** · `blog-backend` · P — concluída em 02/11/2026 (branch `fix/sec-05-tipos-entrada`; 11 problemas reproduzidos e corrigidos, testes em `tests/security/input-types.test.mjs`; o mais grave: objeto no lugar da URL ao remover imagem apagava a galeria inteira)
  - Exemplos que hoje dão erro 500 ou aceitam lixo: `categories` que não é lista em
    `PATCH /subscribers/:id` e `POST /subscribers/manual`; `email` que não é texto no
    cadastro manual; `imageUrl` livre em `DELETE /posts/:id/images`.
  - Corrigir pontualmente aqui; a padronização completa é a VAL-01.
  - **Pronto quando:** teste com objeto/array/número no lugar de texto devolve 422, nunca 500.

- [x] **SEC-06 · Dependências vigiadas** · os dois · P — concluída em 02/11/2026 (branches `fix/sec-06-dependencias`). Front em produção: 39 → 4 alertas (2 críticas e 7 altas resolvidas; TipTap estava com versões misturadas). Vitest 3 → 5 nos dois (crítica em desenvolvimento). Riscos aceitos, com motivo: gRPC do Firestore no front (não entra no build) e uuid do firebase-admin 13 no backend (moderado; a v14 vem pelo Dependabot e pede teste manual do upload de capa)
  - Dependabot (semanal, agrupando atualizações menores) + `npm audit` no CI (CI-01).
  - **Pronto quando:** PRs do Dependabot chegando e CI barrando vulnerabilidade alta.

- [x] **SEC-07 · Alerta quando algo falha** · `blog-backend` · M — concluída em 02/11/2026 (branch `feat/sec-07-alertas`; 14 testes em `tests/cron/daily.test.mjs`, incluindo a publicação de agendados, que não tinha teste). Em produção, conferir `ADMIN_EMAIL` na Vercel: é para onde o alerta vai
  - Hoje só se descobre falha abrindo o painel ou os logs da Vercel.
  - Email para o admin (mesmo mecanismo do aviso de comentário) quando: o cron tem
    `errors`, um agendado não publicou, um envio termina com falhas, o LinkedIn falha, a
    conexão do LinkedIn tem 7 dias ou menos.
  - Rodar o resumo na rotina diária (sem serviço novo).
  - **Pronto quando:** teste do scheduler prova que, com erro, o email de alerta é montado.

- [x] **SEC-08 · Revisão do login de reserva e do SKIP_2FA** · `blog-backend` · P — concluída em 02/11/2026 (branch `fix/sec-08-testes-auth`; 20 testes em `tests/security/auth.test.mjs`, nenhuma brecha encontrada; de quebra, o tratador de erros passou a mostrar o motivo dos 4xx em produção e a não logar stack de recusa esperada)
  - Teste garantindo que `SKIP_2FA` **nunca** vale com `NODE_ENV=production` ou `VERCEL=1`.
  - Teste garantindo que sessão sem `mfa: true`, de usuário inativo, não-admin ou de versão
    antiga é recusada (o que o `auth.middleware` faz hoje).
  - **Pronto quando:** os testes existem e passam (proteção contra regressão).

- [ ] **SEC-09 · Registro de ações do admin (auditoria)** · `blog-backend` · M · opcional
  - Quem/quando publicou, excluiu, enviou email, mudou plano de assinante, apagou de vez.
  - Coleção própria com expiração (ex.: 1 ano). Útil se um dia houver outro autor
    ou se a conta for invadida.

---

## Fase 2 — Duplicatas

- [x] **DUP-01 · Formato único de erro da API** · os dois · M — concluída em 02/11/2026 (branches `refactor/dup-01-formato-erro`; helper `errorBody` no backend, `errorText` no front, 25 leituras repetidas viraram uma; `auth.controller.js`, que não era usado, removido). **Limpeza pendente:** depois que o front novo estiver no ar, tirar o `message` de `app/utils/http.js` e o fallback de `src/utils/apiError.js`
  - A API responde erro de dois jeitos: `{ error }` (103 lugares) e `{ message }` (34, na
    autenticação e no rate limit). O front precisa testar os dois.
  - Padronizar em `{ error }` (com `message` mantido por um tempo nas rotas de auth, para
    não quebrar o painel durante o deploy) e um helper `fail(res, status, msg)`.
  - **Pronto quando:** teste percorre as rotas e todas as respostas 4xx têm `error`.

- [x] **DUP-02 · Categorias em um só lugar** · `blog-backend` · P — concluída em 02/11/2026 (branch `refactor/dup-02-categorias`; teste em `tests/config/categories.test.mjs`)
  - Hoje em 3 lugares: `config/categories.js`, enum do `blogpost.model.js` e
    `ALLOWED_CATEGORIES` no controller (R-POST-02). Model e controller passam a ler do config.
  - **Pronto quando:** adicionar uma categoria exige mudar só `config/categories.js`
    (teste confere).

- [x] **DUP-03 · Validadores compartilhados** · `blog-backend` · P — concluída em 02/11/2026 (branch `refactor/dup-03-validadores`; `app/utils/validators.js`; email, categorias e ids em um lugar só. **Achado:** a SEC-05 tinha quebrado o envio de rascunhos com público "assinantes específicos" ou "públicos" — o público salvo tem ids como ObjectId, não texto. Nunca foi para produção; corrigido e coberto por `tests/campaigns/send.test.mjs`)
  - `EMAIL_RE`, checagem de categorias e de ObjectId repetidos em
    `subscriber.controller`, `campaign.controller`, `audience.routes`.
  - Mover para `app/utils/validators.js`. Base para a VAL-01.

- [x] **DUP-04 · Aviso (toast) único no painel** · `blog-front` · M — concluída em 02/11/2026 (branch `refactor/dup-04-avisos`; 10 telas migradas, ~150 linhas a menos; corrigido o bug do timer que fechava o aviso seguinte; `ConfirmDialog` acessível; Assinantes passou a confirmar sucesso; 13 testes de componente)
  - Cada tela tem o próprio estado de aviso, com tempo e estilo diferentes (PostEditor,
    Calendar, PostsList, Seasons, Showcase, Trash, Comments, Audiences, ImageManager).
  - Um `ToastProvider` + `useToast()` com sucesso/erro/ação ("Desfazer"), `role="status"`.
  - Trocar os 8 `alert()` (Assinantes, seção LinkedIn) e os 3 `window.confirm()`
    (LinkedIn ×2, comentário do leitor) por toast/`ConfirmDialog`.
  - **Pronto quando:** `grep "alert(\|confirm("` não acha nada em `src/` e todas as telas
    usam o mesmo aviso.

- [ ] **DUP-05 · Regras repetidas entre front e back** · os dois · M
  - Duplicadas hoje: geração de slug, URL do artigo com UTM do LinkedIn, situação do envio
    (`statusKey` × `campaignStatusKey`), tempo de leitura, rótulos de público.
  - Regra: **o backend calcula e devolve**; o front só exibe (ex.: API devolve
    `statusKey`, `readingMinutes`, `linkedinArticleUrl`). Onde o front precisa calcular antes
    de salvar (prévia do slug), um teste de contrato compara as duas implementações.

- [x] **DUP-06 · Datas e fuso em um só helper** · `blog-backend` · M — concluída em 02/11/2026 (branch `refactor/dup-06-fuso`; `app/utils/dates.js`; 7 pontos corrigidos; testes passaram a rodar em UTC como a Vercel — o bug não aparecia localmente porque a máquina de desenvolvimento está no fuso do Brasil; o código antigo falha em 8 dos 10 testes novos)
  - `postStats.service` usa `America/Sao_Paulo`; Dashboard ("este mês"), heatmap,
    `todayPlanned` e filtros de data usam o fuso do servidor (UTC). Entre 21h e meia-noite
    os números caem no dia/mês errado.
  - `app/utils/dates.js` com `dayKey`, `startOfDayBR`, `monthRangeBR`; todos passam a usar.
  - **Pronto quando:** teste com relógio às 22h de Brasília no último dia do mês dá o mês certo.

- [x] **DUP-07 · Dividir `blogpost.controller.js`** · `blog-backend` · M · depende de TEST-02 — concluída em 03/11/2026 (branch `refactor/dup-07-controller-posts`; 987 linhas → `app/controllers/posts/` com 5 arquivos de 100–390 linhas; código movido sem mudar regra; os 19 testes da TEST-02 passam antes e depois; teste novo chama as 26 rotas e exige zero erro 500)
  - ~950 linhas misturando público, admin, vitrine e histórico. Separar em
    `post.public`, `post.admin`, `post.showcase`, `post.revisions`, com as regras de status
    (`validatePost`, `syncPublished`, `normalizePlannedAt`) num `post.rules.js`.
  - Só mover código: **nenhuma regra muda**. Os testes da TEST-02 têm que passar antes e depois.

- [x] **DUP-08 · Limpeza de arquivos mortos** · `blog-front` · P — concluída em 02/11/2026 (branch `refactor/dup-08-arquivos-mortos` no blog-front; 6 arquivos, incluindo uma foto de 7,8 MB)
  - Sem nenhuma referência no código: `services/api.bkp.js`, `services/post.user.bk.js`,
    `services/posts.mock.js`, `components/Header/index2.jsx`, `assets/react.svg`,
    `assets/IMG_20250122_130343.jpg`.
  - **Pronto quando:** removidos e `npm run build` passa.

- [x] **DUP-09 · READMEs reais** · os dois · P — concluída em 03/11/2026 (branches `docs/dup-09-readmes`; READMEs em UTF-8 com como rodar, testar, variáveis, scripts e estrutura; o `.env.example` do backend ganhou as 10 variáveis que faltavam)
  - Trocar os READMEs do template (bezkoder / Vite) por: o que é, como rodar, variáveis de
    ambiente, scripts, link para `docs/SISTEMA.md` e este backlog.

---

## Fase 3 — Testes e validadores consistentes

Cada item cobre as regras do SISTEMA.md que ainda não ganharam teste nas fases 1 e 2.

- [ ] **VAL-01 · Validação por esquema em todas as rotas** · `blog-backend` · G
  - Hoje cada rota valida do seu jeito (`str()`, `typeof`, `validatePost`, `pickSeason`…).
  - Adotar `zod`: um esquema por rota (body, params, query), middleware `validate(schema)`
    que responde **422 `{ error }`** padronizado. Campos não previstos são descartados
    (substitui as listas manuais `pickEditable`, `LINKEDIN_EDITABLE`, `SOURCE_FIELDS`).
  - Incluir aqui: slug editado à mão normalizado no update (hoje aceita espaço/maiúscula).
  - Migrar por área: posts → envios → assinantes → públicos → seasons → comentários → auth.
  - **Pronto quando:** toda rota que recebe dados passa por um esquema.

- [x] **TEST-02 · Regras de post** · `blog-backend` · M — concluída em 03/11/2026 (branch `test/test-02-regras-post`; 19 testes em `tests/posts/rules.test.mjs`, mais os já existentes de lixeira, tipos de entrada, HTML e fuso; todas as regras passaram sem mudança no código)
  - R-POST-01 a R-POST-14: validações, status, `publishedAt` preservado, slug único,
    data ao meio-dia UTC, campos públicos, 1ª publicação dispara email + LinkedIn e
    republicação não.

- [ ] **TEST-03 · Regras de email** · `blog-backend` · M
  - R-EMAIL-01 a 13: um aviso por post, público congelado, lotes e retomada, envio iniciado
    não editável, UTMs, rastreio ignorando robôs, teste nunca rastreado.

- [ ] **TEST-04 · LinkedIn** · `blog-backend` · P
  - R-LI-01 a 07 com `fetch` simulado: idempotência, só comentário na nova tentativa,
    "posting" travado exige confirmação, falha não desfaz publicação.

- [ ] **TEST-05 · Rotina diária, seasons, lixeira, histórico** · `blog-backend` · M
  - R-SEASON, R-TRASH, R-REV e cron (publica vencidos, restaurar agendado vencido vira
    rascunho, retoma envios).

- [ ] **TEST-06 · Assinantes, públicos, comentários, vitrine** · `blog-backend` · M
  - R-SUB, R-LIST, R-COM, R-VIT, R-ENG, incluindo os limites de taxa.

- [ ] **TEST-07 · Front: utilitários e editor** · `blog-front` · M
  - `postStatus`, `campaignAudience`, `parseContacts`, `seasonProgress`, `share`.
  - Editor: não salva sem título/categoria/data do agendado; confirma antes de publicar com
    email; aviso de alterações não salvas.

- [ ] **TEST-08 · Ponta a ponta (opcional)** · `blog-front` · G
  - Playwright contra o backend local com banco em memória: criar → agendar → rodar cron →
    post no ar → aviso em Envios.

---

## Fase 4 — Regras de negócio (melhorias)

- [x] **BIZ-01 · Agendar para hoje depois das 9h** · os dois · P — concluída em 03/11/2026 (branches `feat/biz-01-agendar-hoje`; R-POST-16; o editor oferece a data mais cedo possível com botão "Agendar para…", e a API recusa data passada ou hoje depois das 9h; testes com relógio simulado e um que confere o horário com o `vercel.json`)
  - Hoje só publica amanhã (cron 1×/dia). Editor: bloquear "hoje" após 9h com explicação,
    e backend recusar com 422. (Alternativa: cron de hora em hora — avaliar o plano da Vercel.)

- [x] **BIZ-02 · Contador de leituras confiável** · os dois · M — concluída em 03/11/2026 (branches `feat/biz-02-leituras`; R-ENG-03; `GET /slug` virou só leitura; detecção de robô unificada em `app/utils/userAgent.js`). ⚠️ **Deploy: front antes do backend** (com o backend novo e o front antigo, nenhuma leitura seria contada). **Anotar a data do deploy**: números de leitura de antes e depois não são comparáveis (SISTEMA.md 12.4)
  - Tirar o `$inc` de `GET /posts/slug/:slug` (prerender e robôs contam, cache não conta).
    Contar por evento do navegador (como o engajamento), ignorando robôs e o navegador do autor.
  - Afeta destaques, "Continue lendo" e conversão por post: anotar no SISTEMA.md a data da
    mudança (números antes e depois não são comparáveis).

- [x] **BIZ-03 · Dashboard: avisos de post não enviados** · os dois · P — concluída em 03/11/2026 (branches `feat/biz-03-avisos-dashboard`; a consulta virou `campaign.service.unsentPostNotices`, usada pelo alerta diário e pelo Dashboard — uma regra, dois lugares de exibição)
  - Listar `post-notification` em rascunho de posts publicados (R-EMAIL-03).

- [x] **BIZ-04 · Redirecionar slug antigo** · os dois · M — concluída em 03/11/2026 (branches `feat/biz-04-slug-redirect`; R-POST-17; 301 no prerender preservando UTMs, troca de URL no app; slug digitado normalizado; endereço antigo nunca é reusado por outro post; sitemap já lista só o atual. Deploy em qualquer ordem. De quebra: removidos 2 imports sem uso deixados pela DUP-07)
  - Guardar slugs anteriores do post; `/blog/<antigo>` responde 301 para o atual (prerender e sitemap).

- [ ] **BIZ-05 · Provedor de email transacional** · `blog-backend` · M — ⏸️ **adiada por decisão (03/11/2026)**
  - **Decisão:** continuar no Gmail enquanto a base de assinantes for pequena; não vale o
    investimento agora. **Gatilho para retomar:** a base se aproximar do limite diário do
    Gmail (~500 emails/dia), ou falhas de entrega aparecerem no alerta diário (SEC-07).
  - **Quando trocar:** o remetente passa a ser o email do próprio domínio,
    **marcos@marck0101.com.br**. Isso exige configurar SPF, DKIM e DMARC no DNS de
    `marck0101.com.br` (sem eles os emails caem no spam), e trocar `config/mailer.js`
    e o `from` em `services/campaign.service.js` / `services/alerts.service.js`.
  - Ganha também relatório de entrega e bounce.

- [x] **BIZ-06 · Excluir assinante = anonimizar** · `blog-backend` · P — concluída em 03/11/2026 (branches `feat/biz-06-excluir-dados`; achado: excluir apagava o cadastro mas o email continuava no histórico de cada envio; agora sai de tudo e os números dos envios ficam iguais; R-SUB-07)
  - Avaliar (LGPD/histórico): apagar dados pessoais e manter os números dos envios.

---

## Resumo

| Fase | Tarefas | Tamanho estimado |
|---|---|---|
| 0 · Fundação de testes | TEST-00, TEST-01, CI-01 | ~1,5 dia |
| 1 · Segurança | SEC-01 a SEC-09 | ~8–10 dias |
| 2 · Duplicatas | DUP-01 a DUP-09 | ~8–10 dias |
| 3 · Testes e validadores | VAL-01, TEST-02 a TEST-08 | ~12–15 dias |
| 4 · Regras de negócio | BIZ-01 a BIZ-06 | ~6–8 dias |

Estimativas para uma pessoa, com teste incluído em cada tarefa.
