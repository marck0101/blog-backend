# Documentação do sistema — Blog marck0101

> Estado do código em **02/11/2026**. Documento vivo: toda mudança de regra de negócio
> atualiza a seção correspondente **no mesmo commit**.
>
> Cada regra tem um código (`R-POST-03`, `R-EMAIL-02`…). Antes de refatorar ou otimizar
> performance, confira a lista de regras da área: se o comportamento descrito mudar, a
> mudança tem que ser intencional.

## Sumário

1. [Visão geral e arquitetura](#1-visão-geral-e-arquitetura)
2. [Post: ciclo de vida](#2-post-ciclo-de-vida)
3. [Calendário editorial](#3-calendário-editorial)
4. [Seasons (séries)](#4-seasons-séries)
5. [Email: avisos de post e envios](#5-email-avisos-de-post-e-envios)
6. [Assinantes e públicos](#6-assinantes-e-públicos)
7. [LinkedIn](#7-linkedin)
8. [Vitrine, destaques e engajamento do leitor](#8-vitrine-destaques-e-engajamento-do-leitor)
9. [Comentários](#9-comentários)
10. [Histórico de versões e lixeira](#10-histórico-de-versões-e-lixeira)
11. [Rotina diária (cron)](#11-rotina-diária-cron)
12. [Dashboards: como ler](#12-dashboards-como-ler)
13. [Como identificar erros e acertos](#13-como-identificar-erros-e-acertos)
14. [Segurança: o que existe](#14-segurança-o-que-existe)
15. [Feedback ao usuário no painel](#15-feedback-ao-usuário-no-painel)
16. [Brechas e oportunidades de melhoria](#16-brechas-e-oportunidades-de-melhoria)
17. [Checklist para refatorar sem perder regra](#17-checklist-para-refatorar-sem-perder-regra)

---

## 1. Visão geral e arquitetura

O blog é um sistema editorial completo de uma pessoa só: escrever, agendar, publicar,
avisar assinantes por email, divulgar no LinkedIn e medir o resultado.

| Parte | Tecnologia | Onde roda |
|---|---|---|
| `blog-backend` | Node 22, Express, Mongoose (MongoDB) | Vercel (função serverless, limite ~10 s por requisição) |
| `blog-front` | React 19, Vite, Tailwind, TipTap (editor) | Vercel (estático + função `api/prerender.js`) |
| Imagens | Firebase Storage (convertidas para WebP com `sharp`) | Google Cloud |
| Email | Gmail via Nodemailer (`GMAIL_USER` / `GMAIL_APP_PASSWORD`) | — |
| Análise | GA4, Microsoft Clarity, Meta Pixel (só no domínio de produção, fora do `/admin`) | — |

**Áreas do painel** (`/admin/...`): Dashboard, Posts, Calendário, Seasons, Vitrine, Envios
(campaigns), Assinantes, Públicos (audiences), Comentários, Métricas, Lixeira, Segurança.

**Consequência importante da Vercel serverless:** nada roda "em segundo plano". Tudo que é
demorado (envio de email em massa, publicação agendada) ou cabe dentro de uma requisição,
ou é feito em lotes que o painel/cron chamam de novo.

**Quem acessa o painel:** um único perfil, `admin`. O modelo `User` tem os papéis
`editor` e `user`, mas o middleware de autenticação recusa qualquer papel que não seja
`admin` (`app/middlewares/auth.middleware.js`). Hoje não existe multiusuário de verdade.

---

## 2. Post: ciclo de vida

Arquivos: `app/models/blogpost.model.js`, `app/controllers/blogpost.controller.js`,
`blog-front/src/components/PostEditor`, `blog-front/src/utils/postStatus.js`.

### 2.1 Status

| Status | Significado | No ar? | Data usada |
|---|---|---|---|
| `draft` (Rascunho) | Ideia ou texto em andamento. Nunca vai ao ar sozinho. | Não | `plannedAt` opcional = data no calendário |
| `planned` (Agendado) | Pronto. A rotina diária publica na data. | Não (até a data) | `plannedAt` obrigatório = data de publicação |
| `published` (Publicado) | No ar. | Sim | `publishedAt` |
| *Na lixeira* | `deletedAt` preenchido, **independente do status** | Não | `deletedAt` |

Existe também o booleano legado `published`, mantido em sincronia com `status`. As rotas
públicas filtram por `published: true` e `deletedAt: null`.

### 2.2 Regras

- **R-POST-01** Título obrigatório, mínimo 3 caracteres.
- **R-POST-02** Categoria obrigatória e de uma lista fechada: `tecnologia, design, carreira,
  negocios, marketing, trafego, growth`. Um post tem **uma** categoria.
  ⚠️ A lista existe em 3 lugares no backend: `config/categories.js`, enum do model e
  `ALLOWED_CATEGORIES` no controller. Mudar em um exige mudar nos três.
- **R-POST-03** Rascunho pode ter conteúdo vazio. Agendar ou publicar exige conteúdo com
  pelo menos 10 caracteres.
- **R-POST-04** Agendado exige `plannedAt` válido. O editor não deixa escolher data passada
  para agendado (o backend não bloqueia).
- **R-POST-05** Data vinda do formulário (`YYYY-MM-DD`) é gravada às **12:00 UTC** (9h em
  Brasília): cai no mesmo dia em todos os fusos do Brasil e fica antes da rotina diária.
- **R-POST-06** Ao publicar, `publishedAt` = agora — **exceto** se o post já tinha
  `publishedAt` (republicação mantém a data original).
- **R-POST-07** Slug (endereço) é gerado do título no primeiro salvamento (`slugify`,
  minúsculas, sem acento). Se já existir, ganha sufixo `-1`, `-2`…
- **R-POST-08** Mudar o título **não** muda o slug se o slug foi enviado (o editor sempre
  envia). Mudar o slug de um post publicado quebra links compartilhados: o editor avisa,
  mas não há redirecionamento do endereço antigo.
- **R-POST-09** **Primeira publicação** dispara, em paralelo, o aviso por email
  (seção 5) e o post no LinkedIn (seção 7). Falha em qualquer um dos dois **não desfaz** a
  publicação.
- **R-POST-10** Despublicar (voltar para rascunho) tira o post do ar, mantém `publishedAt`
  e **não** gera novo email nem novo LinkedIn ao republicar (um aviso por post, ver
  R-EMAIL-01; LinkedIn já fica como `posted`).
- **R-POST-11** Season é opcional (ver seção 4). Se informada, precisa existir.
- **R-POST-12** Campos que as rotas públicas devolvem estão numa **lista de permitidos**
  (`PUBLIC_FIELDS`). Campo novo de admin (email, LinkedIn, views) nunca vaza por padrão.
- **R-POST-13** Resumo (`excerpt`) até 160 caracteres (limite no editor). SEO title e
  description têm contador com aviso "o Google vai cortar". Texto alternativo de imagem
  até 125 caracteres.
- **R-POST-14** FAQ do post: pares pergunta (≤200) + resposta (≤1500). Pergunta sem
  resposta (ou o contrário) não é salva. Vira `FAQPage` (schema.org).

### 2.3 Fluxo de uma postagem (do zero ao ar)

```
Ideia
 └─ (opcional) content/<pasta>/post.json + content.html  → scripts/import-draft.js
     (sempre entra como RASCUNHO; nunca publica nem envia email)
 └─ ou direto no painel: Posts → Novo post / clique num dia do calendário
        │
        ▼
Rascunho ──(data opcional no calendário)──► Agendado (data obrigatória)
   │                                            │ rotina diária, ~9h do dia
   │ "Publicar agora"                           ▼
   └──────────────────────────────────────► Publicado
                                               ├─ email: aviso de post novo (se ligado)
                                               └─ LinkedIn (se ligado)
```

No editor, tudo do post fica numa tela: conteúdo, capa, galeria, FAQ, SEO, season,
**email** (seção "Email") e **LinkedIn** (seção "LinkedIn").

Proteções do editor (`PostEditor/index.jsx`):
- aviso ao sair com alterações não salvas (navegação interna e fechar a aba);
- rascunho local no navegador a cada 30 s, oferecido para restaurar ao reabrir;
- `Ctrl+S` salva;
- confirmação "enviar para N pessoas?" antes de publicar quando o email está ligado;
- aviso de conflito de data quando o dia já tem outro post, com sugestão da próxima
  terça/sexta livre.

### 2.4 Conteúdo preparado fora do painel

Pasta `content/` + scripts (ver `content/_modelo/GUIA.md`):

- `scripts/import-draft.js content/<pasta>` — post avulso.
- `scripts/import-season.js content/<season>` — season inteira (`season.json` + HTMLs).
- Sem `--apply` só simula; `--prod` aponta para produção; `--update` atualiza rascunho
  existente com o mesmo slug.
- **R-IMPORT-01** Sempre grava como rascunho. Post existente que não é rascunho nunca é
  alterado.
- **R-IMPORT-02** `import-season` recusa conteúdo com trechos proibidos (ex.: prefixo
  interno `GH_`).

---

## 3. Calendário editorial

Arquivos: `blog-front/src/pages/Admin/Calendar.jsx`, `PostStatusField`,
`app/utils/calendarRange.js`, rotas `GET /api/posts/calendar` e `GET /api/campaigns/calendar`.

### O que é

Uma visão no tempo de **tudo que sai do blog**: posts (por status) e envios de email. Serve
para planejar a cadência, ver buracos e conflitos, e mover ideias de data.

### O que faz

- **Visões**: mês, semana ou período personalizado (até 366 dias). Visão, data e filtros
  ficam na URL (`?visao=&data=&de=&ate=`) e sobrevivem ao recarregar.
- **Mostra posts** em cada dia:
  - publicado → no dia de `publishedAt`;
  - agendado ou rascunho com data → no dia de `plannedAt`;
  - rascunho **sem** data → no dia em que foi criado, com borda tracejada.
- **Cores**: verde publicado, azul agendado, cinza rascunho, tracejado rascunho sem data,
  **laranja = agendado atrasado** (data passou e não foi ao ar).
- **Mostra envios de email** (contorno colorido, ícone ✉️): enviado, com falha, enviando,
  rascunho. Aviso automático de post aparece com o título do post.
- **Filtros** multi-seleção: Publicados, Agendados, Rascunhos, Envios (com contagem).
- **Arrastar rascunho** para outro dia muda o `plannedAt`. Pede confirmação, com opção
  "não perguntar de novo hoje" (vale até meia-noite, neste navegador) e oferece
  **Desfazer** no aviso.
- **Clicar num dia vazio** abre "Novo post" com aquela data preenchida.
- **Publicar agora** a partir do calendário.

### O que NÃO faz

- **Não move agendados nem publicados** arrastando — só rascunhos. Agendado tem data real
  de publicação; para mudar, edite o post.
- **Não agenda envios de email.** Envio avulso sai na hora em que você clica "Enviar". O
  calendário só mostra quando aconteceu (ou a última edição, se rascunho).
- **Não agenda LinkedIn** separado do artigo. O LinkedIn sai junto com a publicação.
- **Não publica em horário escolhido.** Agendamento é por **dia**; a publicação acontece
  quando a rotina diária roda (~9h de Brasília).
- **Não bloqueia dois posts no mesmo dia.** Só avisa e sugere outra data.
- Não mostra métricas do post (isso é Dashboard/Métricas/Vitrine).

### Regras

- **R-CAL-01** Só rascunho muda de dia por arraste.
- **R-CAL-02** Cadência sugerida: terça e sexta (`PREFERRED_WEEKDAYS` em `PostStatusField`).
- **R-CAL-03** O backend devolve 1 dia a mais em cada ponta do intervalo (servidor em UTC,
  painel agrupa no fuso do navegador); o front descarta o que cai fora da grade.

---

## 4. Seasons (séries)

Arquivos: `app/models/season.model.js`, `app/controllers/season.controller.js`,
`blog-front/src/pages/Admin/Seasons.jsx`, `SeasonNav`, `SeasonPage`.

### O que é

Uma **season** é uma série de posts que se complementam e têm ordem de leitura (ex.:
"Mídia paga na prática", do primeiro clique ao checklist final). Cada post da série é um
**episódio**.

### Todo post tem season?

**Não.** Season é opcional. A maioria dos posts pode (e deve) ser **avulsa**. Use season
quando o leitor ganha lendo na sequência; use post avulso quando o texto se sustenta
sozinho.

| | Post avulso | Episódio de season |
|---|---|---|
| Campo `season` | `null` | slug da season |
| `seasonOrder` | vazio | número do episódio (ordem de leitura) |
| Página `/seasons/<slug>` | — | lista o episódio |
| Navegação anterior/próximo | — | sim (`SeasonNav`) |
| Progresso "continuar de onde parei" | — | sim (no navegador do leitor) |

### Regras

- **R-SEASON-01** Season tem título (3–100), slug (minúsculas, números, hífen), descrição
  (≤600), ordem na página `/seasons` e FAQ próprio.
- **R-SEASON-02** O slug `admin` é reservado.
- **R-SEASON-03** **Season sem episódio publicado não existe para o leitor** — nem o nome
  aparece (404 na página dela, fora da lista `/seasons`).
- **R-SEASON-04** Episódios são ordenados por `seasonOrder` e, empatando, por data de
  publicação. Só episódios publicados aparecem.
- **R-SEASON-05** Trocar o slug de uma season atualiza todos os posts que usam ela.
- **R-SEASON-06** Excluir season só é permitido se **nenhum** post usa ela — inclusive posts
  na lixeira.
- **R-SEASON-07** A season inicial (`config/seasons.js`) é cadastrada sozinha no banco na
  primeira vez; depois disso, tudo é pelo painel.
- **R-SEASON-08** Tempo de leitura da season = soma dos episódios publicados (~200
  palavras/minuto, mínimo 1 min por episódio).

---

## 5. Email: avisos de post e envios

Arquivos: `app/services/campaign.service.js`, `app/controllers/campaign.controller.js`,
`app/services/tracking.service.js`, `app/templates/campaign.email.js`,
`blog-front/src/components/PostEmailSection`, `pages/Admin/CampaignEditor.jsx`.

Existem **dois tipos de envio** (`Campaign.kind`), e os dois aparecem em **Envios**:

| | Aviso de post novo (`post-notification`) | Envio avulso (`custom`) |
|---|---|---|
| Criado por | Sistema, na 1ª publicação do post | Você, em Envios → Novo |
| Conteúdo | Capa + título + chamada curta + botão "Ler no blog" | HTML livre, pode ligar a um post |
| Configurado em | Seção "Email" do editor do post | Editor de envio |
| Quando sai | Na publicação (manual ou agendada) | Quando você clica Enviar |

### 5.1 Aviso de post novo — como preparar

Na seção "Email" do editor:
- **Avisar assinantes** (`emailNotify`, ligado por padrão).
- **Assunto** — vazio usa `Novo artigo: <título> | marck0101`.
- **Pré-cabeçalho** (texto ao lado do assunto na caixa de entrada) — vazio usa o resumo.
- **Chamada** (`emailTeaser`) — vazio usa o resumo. O email **não** copia o artigo: desperta
  interesse e leva ao blog.
- **Público** — padrão "categoria do post" (ver 6.2).
- **Enviar teste** — manda para o seu email, com `[TESTE]` no assunto, mesmo antes de salvar.

### 5.2 Regras de email

- **R-EMAIL-01** **Um aviso por post, para sempre.** Se já existe um `post-notification`
  para aquele post, nada é criado nem enviado de novo — nem ao despublicar e republicar.
- **R-EMAIL-02** O público "categoria do post" é resolvido **na hora da publicação** com a
  categoria atual do post.
- **R-EMAIL-03** Se o público tem 0 pessoas ativas, ou o Gmail não está configurado, o aviso
  é criado como **rascunho** em Envios e **não sai sozinho depois**: precisa ser enviado
  pelo painel.
- **R-EMAIL-04** A lista de destinatários é **congelada** no primeiro envio (snapshot em
  `recipients`). Quem assinar depois não entra; quem cancelar no meio é marcado como falha
  ("inscrição cancelada") e não recebe.
- **R-EMAIL-05** Envio em lotes de 5 em paralelo, com orçamento de 7 s por chamada. Se não
  couber, o envio fica **"enviando"**; o painel chama de novo, e a rotina diária retoma os
  que ficaram parados.
- **R-EMAIL-06** Envio iniciado não pode ser editado nem excluído (só rascunho).
- **R-EMAIL-07** "Tentar de novo" volta só as falhas para pendente.
- **R-EMAIL-08** Duplicar: "cópia" (mesmo público) ou "novos membros" (só membros ativos que
  ainda não receberam o original).
- **R-EMAIL-09** Botão "Ler no blog" só aparece se o post ligado estiver publicado.
- **R-EMAIL-10** Links para o próprio blog ganham UTM automaticamente:
  `utm_source=newsletter`, `utm_medium=email`, `utm_campaign=aviso-post-<slug>` ou
  `envio-<slug>`, `utm_content=link_texto | botao_ler_no_blog`. Links externos ficam como
  estão. Link que já tem UTM não é alterado.
- **R-EMAIL-11** Rastreio (pixel de abertura + clique) só em envios reais; email de teste
  nunca é rastreado.
- **R-EMAIL-12** Todo email tem link de cancelamento e cabeçalho `List-Unsubscribe`.
  Cancelar pelo link de um envio atribui a saída àquele envio.
- **R-EMAIL-13** Conteúdo para membros (`audience.type = members`) ganha selo de conteúdo
  exclusivo no template.

### 5.3 Rastreio: o que conta

- **Abertura** = pixel carregado **ou** clique (quem bloqueia imagem mas clicou, abriu).
- **Clique** = link rastreado (URL assinada com HMAC; sem assinatura válida redireciona para
  a home — não vira redirecionador aberto).
- **Automático (descartado das taxas)**: user-agent de robô/antivírus (Proofpoint, Mimecast,
  SafeLinks…) ou clique em menos de 10 s após a entrega. Fica registrado, fora das taxas.
- Envios anteriores ao rastreio aparecem **sem taxas** (não há como saber).

---

## 6. Assinantes e públicos

Arquivos: `app/models/subscriber.model.js`, `app/controllers/subscriber.controller.js`,
`app/routes/audience.routes.js`, `blog-front/src/components/SubscribeForm`.

### 6.1 Assinante

- **R-SUB-01** Inscrição pública: email válido + categorias de interesse (opcional) + origem
  (página, post, UTM, referrer, primeira página da visita).
- **R-SUB-02** A resposta é **a mesma** para email novo e já inscrito (não revela quem é
  assinante). Assinante ativo que se inscreve de novo **não é alterado**.
- **R-SUB-03** Quem tinha cancelado e se inscreve de novo volta a ativo, com as categorias
  novas.
- **R-SUB-04** Limite: 5 inscrições por IP a cada 30 min.
- **R-SUB-05** Plano: `free` (recebe avisos de posts) ou `member` (recebe também envios
  exclusivos). Mudar o plano reinicia o "membro desde".
- **R-SUB-06** Cancelar pelo link do email é idempotente: clicar de novo não muda a data.
- **R-SUB-07** Excluir assinante no painel é **definitivo** (não vai para lixeira).
- **R-SUB-08** Exportação CSV com os mesmos filtros da lista (separador `;`, BOM UTF-8, e
  células que começam com `= + - @` viram texto — não executam fórmula no Excel).

### 6.2 Públicos de um envio

| Tipo | Quem recebe (sempre só ativos) |
|---|---|
| `post-category` | Quem segue a categoria do post (só no aviso de post) |
| `members` | Membros |
| `all` | Todos |
| `categories` | Quem segue ao menos uma das categorias escolhidas |
| `selected` | Pessoas escolhidas uma a uma |
| `lists` | Quem está em um ou mais **públicos nomeados** |

"Exceto membros" vale para `post-category`, `all`, `categories` e `lists`.

### 6.3 Públicos nomeados (listas)

- **R-LIST-01** Nome único (sem diferenciar maiúsculas/acentos).
- **R-LIST-02** Importação de lista exige marcar que as pessoas autorizaram receber emails;
  até 1000 linhas por chamada (o painel divide).
- **R-LIST-03** Lixeira: o público some do painel e dos envios, mas as pessoas continuam
  ligadas a ele; restaurar devolve tudo.
- **R-LIST-04** Não dá para apagar público usado por envio em rascunho ou por email de post
  ainda não publicado.
- **R-LIST-05** Excluir de vez (só da lixeira) desfaz o vínculo; as pessoas continuam
  assinantes.

---

## 7. LinkedIn

Arquivos: `app/services/linkedin.service.js`, `app/routes/linkedin.routes.js`,
`blog-front/src/components/PostLinkedInSection`, `src/utils/linkedin.js`.

### Como funciona

Na seção "LinkedIn" do editor você prepara um post para o **perfil pessoal**:
- **Texto** próprio (não é o artigo; o feed mostra só o começo, o resto fica no "…mais");
- **Imagem** própria (vazia usa a capa do artigo);
- **Comentário** com o link do artigo. `{link}` vira a URL do artigo com UTM
  (`utm_source=linkedin`, `utm_medium=social`, `utm_campaign=post-<slug>`,
  `utm_content=comentario`).

Quando o artigo é publicado (manual ou agendado):
1. sobe a imagem para o LinkedIn;
2. cria o post com o texto;
3. comenta o link do artigo.

Fixar o comentário **só dá pelo app do LinkedIn** (a API não permite) — faça manualmente.

### Regras

- **R-LI-01** Link no comentário, não no post (o LinkedIn entrega menos posts com link).
- **R-LI-02** Idempotente: só um processo "pega" o post (`idle/failed → posting`). Se o post
  já foi criado e só faltou o comentário, a nova tentativa faz só o comentário (não duplica).
- **R-LI-03** "Posting" parado há mais de 5 min = tentativa interrompida. Nova tentativa só
  com confirmação ("o post NÃO apareceu no seu perfil?"), para não publicar duas vezes.
- **R-LI-04** Falha no LinkedIn não desfaz a publicação nem o email. O erro fica gravado no
  post e aparece no editor, com botão para tentar de novo.
- **R-LI-05** A conexão vale **60 dias** e não renova sozinha: é preciso reconectar pelo
  painel antes de expirar. O editor mostra quantos dias faltam.
- **R-LI-06** Uma conta conectada por vez; conectar de novo substitui a anterior.
- **R-LI-07** O painel só edita texto, imagem, comentário e liga/desliga. Status, URNs e
  erros são do sistema.

---

## 8. Vitrine, destaques e engajamento do leitor

Arquivos: `app/services/postStats.service.js`, `pages/Admin/Showcase.jsx`.

- **R-VIT-01 Fixados**: até 3 posts no topo da home, na ordem do painel. Fixados não
  repetem na lista da home. Ir para a lixeira desafixa.
- **R-VIT-02 Destaques da semana** (até 4): primeiro os **forçados** no painel (mais recentes
  primeiro), depois os **mais lidos dos últimos 7 dias**. Fixados e posts marcados
  "esconder" nunca entram.
- **R-VIT-03** "Últimos 7 dias" inclui hoje e usa o fuso de Brasília.
- **R-VIT-04 Continue lendo** (fim do post): 3 posts da mesma categoria, mais lidos
  primeiro; se faltar, completa com os mais lidos das outras. Nunca o próprio post.
- **R-ENG-01** Favoritar, desfavoritar, compartilhar (por canal) e "visita por link
  compartilhado" são **anônimos**: só somam contadores do post. Limite de 60 eventos por IP
  a cada 10 min.
- **R-ENG-02** Favoritos do leitor ficam no navegador dele (não há conta de leitor para isso).

---

## 9. Comentários

Arquivo: `app/routes/comment.routes.js`, `pages/Admin/Comments.jsx`, `components/Comments`.

- **R-COM-01** Leitor entra com Google para comentar (sessão própria de 30 dias, que não
  serve para o painel).
- **R-COM-02** Comentário entra **pendente** e só aparece depois de aprovado. O próprio autor
  vê os seus pendentes ("aguardando aprovação").
- **R-COM-03** Texto puro, até 2000 caracteres. 5 comentários por IP a cada 10 min; no
  máximo 5 pendentes por pessoa.
- **R-COM-04** Um nível de resposta: resposta sempre presa a um comentário principal
  aprovado do mesmo post.
- **R-COM-05** Resposta do autor do blog (pelo painel) aparece na hora e **aprova** o
  comentário respondido.
- **R-COM-06** O autor do blog recebe email a cada comentário novo.
- **R-COM-07** O leitor pode apagar o próprio comentário (e as respostas que ele recebeu).
- **R-COM-08** Email e id Google do leitor nunca aparecem para o público.

---

## 10. Histórico de versões e lixeira

### Histórico (`app/services/postRevision.service.js`)

- **R-REV-01** Cada gravação que muda **o que o leitor vê** (título, slug, resumo, conteúdo,
  categoria, season, ordem, capa, galeria, FAQ, SEO) cria uma versão nova (v1, v2…).
  Gravação sem mudança não cria versão.
- **R-REV-02** Status, datas, email, LinkedIn, vitrine e métricas **não** entram no
  histórico. Por isso restaurar uma versão não despublica, não reagenda e não reenvia nada.
- **R-REV-03** Restaurar cria uma versão **nova** com o conteúdo antigo (nada é apagado). O
  slug atual é mantido (não quebra links). Se a season da versão foi apagada, o post fica
  na season atual.
- **R-REV-04** Versões só são apagadas na exclusão definitiva do post.

### Lixeira

- **R-TRASH-01** Excluir manda para a lixeira (`deletedAt`) e desafixa da vitrine.
- **R-TRASH-02** Restaurar um agendado cuja data já passou o transforma em **rascunho** (senão
  ele iria ao ar sozinho no próximo cron).
- **R-TRASH-03** Exclusão definitiva pede para digitar uma confirmação
  (`TypedConfirmDialog`) e só vale para post que **já está na lixeira** (a API responde 409
  para os demais). Apaga o post, o histórico, os comentários e as estatísticas diárias dele.
  Envios ligados ao post **ficam** (histórico de quem recebeu o quê), sem o vínculo.

---

## 11. Rotina diária (cron)

`vercel.json` → `GET /api/cron/daily` às **12:00 UTC (9h de Brasília)**, protegida por
`CRON_SECRET`. Código: `app/services/scheduler.service.js`.

1. Publica os **agendados** com `plannedAt <= agora` (mais antigos primeiro), disparando
   email e LinkedIn de cada um.
2. Retoma os envios de email que ficaram em **"enviando"**.

O resumo sai no log da Vercel como `[CRON] {"published":[…],"linkedin":[…],"resumed":[…],"errors":[…]}`.

---

## 12. Dashboards: como ler

### 12.1 Dashboard (`/admin`)

| Bloco | O que mostra | Como ler |
|---|---|---|
| Posts | Total, publicados, rascunhos, agendados, lixeira | Agendados = fila de publicação. Se zero, a cadência vai parar. |
| Comparação mensal | Publicados e assinantes novos neste mês vs. mês passado | Mês do calendário, não "últimos 30 dias". No início do mês sempre parece queda. |
| Rascunhos parados | Rascunhos sem edição há mais de 30 dias | Decida: agendar, juntar com outro ou apagar. |
| Último post | Título e data | Mais de 1 semana sem post = cadência quebrada. |
| Desempenho de conteúdo | 10 posts mais lidos (total histórico) | Ver ressalva sobre "leituras" em 12.4. |
| Termos buscados | O que leitores procuraram na busca do blog (30 dias) | **Busca sem resultado = pauta.** Termo que se repete e você não cobre é sugestão de post. |
| Heatmap | Publicações por dia no ano | Mostra consistência. Buracos longos = períodos sem publicar. |

### 12.2 Métricas (`/admin/metrics`, período 7–365 dias)

**Audiência**
- *Assinantes ativos / membros* — tamanho da base hoje.
- *Novos no período* e *Cancelamentos* — crescimento líquido = novos − cancelamentos.
- *Taxa de crescimento* e *churn* — sobre a base no início do período (aproximada).
- *De onde vêm os novos* — canal da visita em que a pessoa se inscreveu: Email, Pago,
  Social, Campanha (UTM), Busca orgânica, Outros sites, Direto, Cadastro manual.
- *Posts que mais geram assinantes* — inscrições feitas dentro do post. A "conversão" divide
  pelas **leituras totais** do post (não do período): use para comparar posts entre si, não
  como taxa absoluta.
- *Onde a pessoa se inscreveu* — home, post, etc.

**Email** (só envios com rastreio)
- *Abertura* = aberturas únicas ÷ entregues. Leia como **tendência**: Apple Mail e alguns
  clientes carregam o pixel sozinhos (abertura inflada); quem bloqueia imagem e não clica
  não conta.
- *Clique* = cliques únicos ÷ entregues. **É a métrica mais confiável do email.**
- *CTOR* = cliques ÷ aberturas: qualidade do conteúdo para quem abriu.
- *Cancelamento por email* = saídas pelo link ÷ entregues. Acima de ~0,5% por envio merece
  atenção (assunto, frequência ou público errado).
- *Desempenho por envio* e *Links mais clicados* (pessoas únicas).

**Engajamento nos posts**
- Favoritos, compartilhamentos (botão usado), visitas que chegaram por link compartilhado
  (`utm_medium=share`) e comentários.
- Compartilhamento sem visitas = as pessoas divulgam mas ninguém clica (título/imagem fraca
  na rede). Visitas altas com poucos compartilhamentos = poucos compartilhamentos muito bons.

### 12.3 Vitrine (`/admin/showcase`)

Ranking dos mais lidos em 7 dias, com favoritos, compartilhamentos e comentários totais, e o
que está nos destaques agora (e por quê: forçado ou automático).

### 12.4 Ressalva sobre "leituras" (views)

O contador `views` do post **não é o número de leitores**:
- a primeira visita a `/blog/<slug>` passa pelo prerender, que fica em cache na CDN por 10
  min: visitas servidas do cache **não contam**;
- robôs/crawlers que pegam o prerender **contam**;
- o seu próprio navegador **conta** (o opt-out do autor vale só para GA4/Clarity/Pixel).

Use `views` para **comparar posts entre si** e para os destaques. Para números absolutos de
audiência, use o **GA4** (evento `post_view`).

---

## 13. Como identificar erros e acertos

### 13.1 Onde os erros aparecem

| Sinal | Onde ver | O que fazer |
|---|---|---|
| Post **laranja** no calendário | Calendário | Agendado não foi ao ar. Ver log do cron na Vercel. |
| Envio "com falha" / "parcial" | Envios, calendário (contorno vermelho) | Abrir o envio, ver o erro por destinatário, "Tentar de novo". |
| Envio parado em "enviando" | Envios | Abrir e continuar; o cron também retoma no dia seguinte. |
| Aviso de post em **rascunho** | Envios, seção Email do post | Público vazio ou Gmail sem credencial (R-EMAIL-03). Enviar manualmente. |
| LinkedIn "falhou" | Seção LinkedIn do editor | Ler o erro, conferir no perfil, tentar de novo. |
| LinkedIn perto de expirar | Seção LinkedIn do editor (dias restantes) | Reconectar. |
| Comentários pendentes | Menu Comentários (contador) | Aprovar/recusar. |
| Rascunhos parados | Dashboard | Decidir o destino. |
| "Erro interno do servidor" | Painel | Falha do servidor (5xx): em produção o detalhe não aparece na tela, ver **Logs da Vercel** do backend (stack completa). Recusas (4xx) mostram o motivo na tela e aparecem no log numa linha `[HTTP 4xx]`, sem stack. |

**Prefixos nos logs da Vercel** (backend): `[CRON]`, `[EMAIL]`, `[CAMPAIGN]`, `[LINKEDIN]`,
`[HISTÓRICO]`, `[TRACK]`, `[STATS]`, `[COMMENTS]`.

**Códigos HTTP que a API usa:** 401 sessão inválida · 403 origem não permitida · 404 não
encontrado · 409 conflito (duplicado, envio já iniciado, LinkedIn já publicado) · 422 dado
inválido (a mensagem é mostrada ao usuário) · 429 muitas tentativas · 502 erro do LinkedIn ·
503 serviço não configurado (Gmail, Firebase, LinkedIn, cron).

### 13.2 Como saber se um post acertou

Olhe nesta ordem, 7 e 30 dias depois da publicação:
1. **Leituras em 7 dias** (Vitrine) comparadas com os outros posts.
2. **Assinantes gerados** pelo post (Métricas → Posts que mais geram assinantes).
3. **Clique no email** do aviso (Envios → o envio do post).
4. **Compartilhamentos e visitas por compartilhamento** (Métricas → Engajamento).
5. **Comentários**.
6. **GA4** para tempo de leitura e origem; **Clarity** para ver até onde as pessoas rolam.

---

## 14. Segurança: o que existe

**Sim, há validadores de segurança em várias camadas.** Inventário:

### Acesso ao painel
- Login em **duas etapas obrigatórias**: Google (principal) ou email+senha (reserva) →
  **código do app autenticador (TOTP)** ou código de recuperação. Nenhum caminho pula a
  etapa 2 em produção.
- Conta Google vinculada no primeiro login; depois, só aquela conta entra.
- Segredo do autenticador criptografado no banco (AES-256-GCM); código TOTP não vale duas
  vezes; 10 códigos de recuperação de uso único (guardados como hash).
- Sessão em **cookie httpOnly** (JavaScript da página não lê o token), 7 dias, `SameSite=Lax`,
  `Secure` em produção.
- Sair, trocar senha ou refazer o 2FA **derruba todas as sessões** (versão de sessão no JWT).
- Toda rota do painel confere: sessão válida, 2FA concluído, usuário ativo e `admin`.
- **CSRF**: ação que altera dados só é aceita vinda de origem do painel (lista em
  `config/origins.js`).
- **Rate limit** no banco (funciona entre instâncias serverless): login 10/15 min, 2FA
  5/15 min, esqueci a senha 5/h, inscrição 5/30 min, comentário 5/10 min, engajamento
  60/10 min.
- "Esqueci a senha" responde igual para email existente ou não; token vale 1 h.

### Entrada de dados
- Query string em modo "simple" e parâmetros convertidos para texto (`str()`): bloqueia
  injeção de operadores do MongoDB (`?search[$ne]=x`).
- Busca escapada (`escapeRegex`): texto do leitor nunca vira expressão regular (ReDoS).
- Validação de modelo (Mongoose) e validações de negócio com mensagem clara (422).
- Upload: só JPEG/PNG/WEBP, até 5 MB, convertido para WebP no servidor.
- Comentários: texto puro, caracteres de controle removidos, redirecionamento só para
  páginas do próprio blog.
- CSV exportado protegido contra injeção de fórmula.
- Links rastreados de email assinados com HMAC (não viram redirecionador aberto).

### Dados expostos
- Rotas públicas devolvem só campos de uma **lista de permitidos**.
- Inscrição não revela se o email já é assinante.
- Token de assinante e de LinkedIn nunca saem nas listagens.

### Cabeçalhos
- API: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, sem
  `X-Powered-By`, CORS restrito.
- Front: os mesmos + `Permissions-Policy` e CSP `frame-ancestors 'none'; object-src 'none';
  base-uri 'self'`. `/admin` com `noindex`.

---

## 15. Feedback ao usuário no painel

**Sim, existe feedback para salvar, cancelar, excluir etc.** Inventário:

| Ação | Feedback |
|---|---|
| Salvar post | Botão muda de texto ("Salvando…", "Publicar", "Agendar publicação", "Salvar rascunho", "Salvar alterações"); aviso verde/vermelho com o resultado; validação antes de enviar (título, categoria, data do agendado) |
| Sair do editor sem salvar | Diálogo de confirmação (navegação interna) e aviso do navegador (fechar aba) |
| Rascunho local | Faixa "Há alterações não salvas de <data>" com Restaurar / Descartar |
| Publicar com email | Confirmação "enviar para N pessoas?" |
| Restaurar versão | Confirmação; avisa que alterações não salvas serão descartadas |
| Mover rascunho no calendário | Confirmação + "Desfazer" no aviso |
| Excluir (posts, envios, seasons, públicos, comentários, assinantes) | `ConfirmDialog` |
| Excluir definitivamente da lixeira | Confirmação digitada (`TypedConfirmDialog`) |
| Erros da API | Mensagem do servidor (422/409) mostrada no aviso vermelho |
| Carregamento | Skeletons nas listas e no editor |

Pontos fracos de feedback estão na seção 16.

---

## 16. Brechas e oportunidades de melhoria

Ordenadas por impacto. Nada aqui está corrigido ainda.

### Regras de negócio / comportamento

1. **Agendar para hoje depois das 9h só publica amanhã.** O cron roda uma vez por dia às
   9h; o editor permite escolher a data de hoje para agendado. *Sugestão:* bloquear "hoje"
   após 9h (ou avisar), ou rodar o cron mais vezes.
2. **Contador de leituras impreciso** (ver 12.4). Afeta "mais lidos", destaques da semana,
   "Continue lendo" e a conversão de assinantes por post. *Sugestão:* registrar a leitura
   por uma chamada do navegador (como o evento de engajamento), ignorando robôs e o
   navegador do autor.
3. **Cancelamento de inscrição por GET com um clique.** Antivírus de email que "visitam" os
   links podem descadastrar pessoas sem elas saberem. Falta também `List-Unsubscribe-Post`
   (cancelamento em um clique exigido por Gmail/Yahoo para remetentes em volume).
   *Sugestão:* página de confirmação + POST.
4. **Aviso de post que nasceu como rascunho nunca sai sozinho** (R-EMAIL-03). É regra, mas é
   fácil esquecer. *Sugestão:* destacar no Dashboard "avisos de post não enviados".
5. **Slug editado à mão não é normalizado no backend** ao atualizar (pode gravar espaço ou
   maiúscula) e **não há redirecionamento** do slug antigo. *Sugestão:* aplicar `slugify` no
   update e guardar slugs anteriores para redirecionar (301).
6. **Datas no fuso do servidor (UTC) em parte dos cálculos**: "este mês" do Dashboard,
   heatmap, "agendados hoje" e filtros de data das listas usam UTC; estatísticas de leitura
   usam Brasília. Entre 21h e meia-noite os números podem cair no dia/mês errado.
   *Sugestão:* padronizar `America/Sao_Paulo` em todos.
7. ~~**Exclusão definitiva deixa órfãos**~~ — resolvido na SEC-04 (ver R-TRASH-03).
8. **Limite do Gmail**: conta Gmail comum envia ~500 emails/dia (Workspace ~2000). Com a base
   crescendo, envios vão falhar no meio. *Sugestão:* migrar para um provedor transacional
   (Resend, SES, Brevo) antes de chegar perto disso.
9. **Excluir assinante é definitivo**; para histórico/LGPD, avaliar "anonimizar" em vez de
   apagar.

### Segurança (defesa em profundidade)

10. **HTML do post é renderizado sem sanitização** (`dangerouslySetInnerHTML` em
    `pages/Blog/Post.jsx` e nas prévias). Hoje só o admin escreve, então o risco depende de
    a conta admin ou um arquivo importado estar comprometido. *Sugestão:* sanitizar com
    DOMPurify no salvamento (backend) e/ou na renderização, e endurecer a CSP com
    `script-src`.
11. Papéis `editor`/`user` existem no modelo mas não têm uso. Se um dia houver outro autor,
    a autorização precisa ser desenhada (hoje é tudo ou nada).

### Feedback / UX

12. **Aviso (toast) duplicado em cada tela**, com tempos e estilos diferentes.
    *Sugestão:* um componente/contexto único de avisos.
13. **`alert()` e `window.confirm()` nativos** ainda em Assinantes, seção LinkedIn e
    comentários do leitor — fogem do padrão `ConfirmDialog` e não são acessíveis da mesma
    forma.
14. O aviso de sucesso some em 3 s e não tem `role="status"` em todas as telas (leitor de
    tela não anuncia).

### Engenharia

15. **Não há testes automatizados** (`npm test` só imprime erro). É o maior risco para
    "melhorar performance sem perder regra". *Sugestão:* testes de caracterização das
    regras deste documento antes de qualquer refatoração grande (começar por R-POST,
    R-EMAIL, R-LI e cron).
16. **Categorias em 3 lugares** no backend (R-POST-02) e regras repetidas entre front e back
    (cálculo de slug, URL do LinkedIn, status do envio). *Sugestão:* fonte única.
17. `blogpost.controller.js` tem ~950 linhas misturando público, admin, vitrine e histórico.
18. READMEs dos dois repositórios ainda são os do template original.

---

## 17. Checklist para refatorar sem perder regra

Antes de abrir o PR de refatoração/performance:

- [ ] Listei as regras (`R-…`) das áreas tocadas e confirmei cada uma, manualmente ou com teste.
- [ ] Rotas públicas continuam devolvendo **só** a lista de campos permitidos.
- [ ] Primeira publicação ainda dispara email **e** LinkedIn, e falha neles não desfaz a publicação.
- [ ] Republicar não reenvia email nem LinkedIn.
- [ ] Agendado continua indo ao ar na rotina diária, e restaurar agendado vencido vira rascunho.
- [ ] Envio continua em lotes (serverless: nada roda em segundo plano).
- [ ] Visualização de post continua **sem** alterar `updatedAt` (`timestamps: false`).
- [ ] Datas `YYYY-MM-DD` continuam gravadas ao meio-dia UTC.
- [ ] Histórico: só campos que o leitor vê; restaurar não muda status nem slug.
- [ ] Season sem episódio publicado continua invisível para o leitor.
- [ ] Rate limits e checagem de origem (CSRF) continuam nas mesmas rotas.
- [ ] Atualizei este documento.
