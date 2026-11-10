# blog-backend

API do blog [marck0101](https://blog.marck0101.com.br): posts, calendário editorial,
seasons, emails para assinantes, LinkedIn, comentários, métricas e o painel administrativo.
O site e o painel estão no repositório **blog-front**.

| | |
|---|---|
| Stack | Node 22 · Express 4 · MongoDB (Mongoose 7) |
| Produção | Vercel (função serverless) · `https://api.blog.marck0101.com.br` |
| Imagens | Firebase Storage (convertidas para WebP com `sharp`) |
| Email | Gmail (Nodemailer) |

## Documentação

- **[docs/SISTEMA.md](docs/SISTEMA.md)**: o que o sistema faz e as regras de negócio
  (códigos `R-…`), como ler os dashboards, como achar erros, segurança e
  **convenções do código (seção 18)**. Comece por aqui.
- **[docs/OPERACAO.md](docs/OPERACAO.md)**: regras de deploy, dependências, SEO/IA, segurança e
  ambiente local. Leia antes de subir código.
- **[docs/BACKLOG.md](docs/BACKLOG.md)**: tarefas de melhoria, com prioridade e critério de pronto.
- **[content/_modelo/GUIA.md](content/_modelo/GUIA.md)**: como escrever e importar um artigo.

## Rodar localmente

Pré-requisitos: Node 22+ e um MongoDB local (ou um banco de teste no Atlas).

```powershell
npm install
copy .env.example .env      # preencha os valores (ver "Variáveis de ambiente")
npm run dev                 # API em http://localhost:3333
```

No primeiro boot em desenvolvimento, o admin do `.env` (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) é
criado. Para dados de exemplo: `node scripts/seed-dev.js`.

## Testes

```powershell
npm test              # roda tudo uma vez (o mesmo que a CI)
npm run test:watch    # roda de novo a cada alteração
```

Os testes usam um **MongoDB em memória** e se recusam a rodar contra qualquer outro banco.
Nenhum email é enviado e nenhuma chamada externa é feita. Rodam no fuso UTC, como a Vercel.
Detalhes e convenções: [docs/SISTEMA.md, seção 18](docs/SISTEMA.md#18-convenções-do-código-manutenção-e-suporte).

## Variáveis de ambiente

Todas estão em [.env.example](.env.example), com explicação. Resumo:

| Variável | Para quê | Sem ela |
|---|---|---|
| `MONGO_URI_DEV` / `MONGO_URI_PROD` | Banco (dev / produção) | A API não sobe |
| `JWT_SECRET` | Assina sessões e links | A API não funciona |
| `MFA_SECRET_KEY` | Criptografa o app autenticador (2FA) | Usa chave derivada do `JWT_SECRET` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Login com Google (painel e comentários) | Só login por senha; sem comentários |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Envio de emails | Avisos ficam como rascunho; envios recusados |
| `ADMIN_EMAIL` | Recebe alertas diários e avisos de comentário | Usa `GMAIL_USER` |
| `CRON_SECRET` | Protege a rotina diária (`/api/cron/daily`) | Rotina diária desligada (503) |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI` | Post automático no LinkedIn | LinkedIn indisponível |
| `FIREBASE_STORAGE_BUCKET` + credencial | Upload de imagens | Upload indisponível (503) |
| `TRACKING_SECRET` | Assina links rastreados dos emails | Usa `JWT_SECRET` |

## Scripts (`scripts/`)

Todos simulam por padrão e só gravam com `--apply`; `--prod` usa o banco de produção
quando o script aceita. Leia o cabeçalho do arquivo antes de rodar.

| Script | Quando usar |
|---|---|
| `import-draft.js` / `import-season.js` | Importar artigo ou season de `content/` como rascunho |
| `sanitize-content.js` | Relatório (e limpeza) de HTML perigoso já gravado |
| `reset-2fa.js` | Emergência: perdeu o celular **e** os códigos de recuperação |
| `seed-dev.js` | Popular o banco local com dados de teste |
| `backfill-*.js`, `fix-*.js`, `migrate-*.js` | Correções pontuais já aplicadas; mantidos como registro |

## Estrutura

```
app/
  app.js            Express: segurança básica, rotas e tratador global de erros
  config/           categorias, origens permitidas, URLs, banco, email, Firebase
  controllers/      regras de cada recurso (posts, envios, assinantes, seasons)
  routes/           rotas HTTP (algumas com a lógica junto, quando é pequena)
  services/         email, LinkedIn, rotina diária, alertas, estatísticas, histórico
  utils/            datas (fuso), validadores, HTML seguro, sessão, formato de erro
  models/           schemas do MongoDB
  templates/        HTML dos emails
api/index.js        entrada na Vercel
server.js           entrada local (npm run dev)
tests/              testes (Vitest + Supertest + MongoDB em memória)
docs/               documentação
content/            artigos preparados fora do painel
```

## Deploy

Push na `main` → a Vercel publica. A CI (GitHub Actions) roda testes e auditoria de
dependências em todo push e PR. Quando uma mudança depende de outra no front, a ordem de
deploy vem anotada na tarefa em [docs/BACKLOG.md](docs/BACKLOG.md).
