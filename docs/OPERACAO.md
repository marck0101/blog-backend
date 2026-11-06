# Operação — API (node-express-mongodb)

Regras que não aparecem no código e que, se esquecidas, quebram algo em
produção. Vale para quem mexe no projeto (pessoa ou agente de IA). As regras
do front ficam em `Front Admin/blog-panel/docs/OPERACAO.md`.

## Deploy

- Push na `main` publica sozinho (Vercel, projeto `node-express-mongodb`,
  domínio `api.blog.marck0101.com.br`). Faça `git fetch` antes: o projeto
  também recebe commits de outro computador.
- **Quando o front passa a depender de uma rota nova da API, sobe a API
  primeiro** e espera a rota responder em produção antes do push do front.
  Exemplos: `/api/auth/session` (sem ela o painel manda todo mundo para o
  login) e `/llms-full.txt` (sem ela o domínio do blog dá 404).
- Conferência rápida depois do deploy: `curl https://api.blog.marck0101.com.br/api/health`.

## Dependências (`package-lock.json`)

- **Use o npm 12** para instalar ou atualizar pacotes:
  `npx npm@12.2.2 install <pacote>`. O npm 11 apaga os campos `libc` das
  variantes do `sharp` no lockfile, e a Vercel pode instalar a variante
  errada (glibc/musl) e quebrar o processamento de imagens.
- Antes do commit, `git diff package-lock.json` deve mostrar só o que foi
  adicionado. Linhas `libc` removidas = refazer com o npm 12.

## Conteúdo para IA e SEO

- `/llms.txt` (10 posts mais recentes) e `/llms-full.txt` (texto integral de
  todos os posts publicados) são gerados do banco a cada acesso, em
  `app/routes/sitemap.routes.js`. Publicar um post já atualiza os dois; a
  CDN guarda por até 5 minutos. **Não existe passo manual.**
- Só entra conteúdo público: post publicado e fora da lixeira, season com ao
  menos um episódio publicado. Qualquer campo novo nesses arquivos precisa
  respeitar o mesmo filtro.
- `app/config/siteFaq.js` é **cópia** do FAQ da home e de `/seasons` que está
  no front (`src/seo/site.js`). Mudou lá, mude aqui no mesmo dia (ver
  backlog: "Uma fonte só para o FAQ do blog").

## Segurança (regras do painel e dos comentários)

- Sessão do painel: cookie `admin_session`, validado por `resolveSession` em
  `app/middlewares/auth.middleware.js` (token, origem para CSRF, 2º fator,
  versão da sessão e usuário admin ativo). Toda rota de admin usa o
  middleware `auth`; rotas novas de admin precisam dele.
- `GET /api/auth/session` responde `{ user: null }` sem login (200, não 401)
  para o console do navegador não mostrar erro; nunca devolve dado sem
  sessão válida. `/api/auth/me` continua 401 sem login.
- Leitor que entra com Google para comentar recebe o cookie `reader_session`
  (só vale em `/api/comments`) e só pode: comentar, responder comentário
  aprovado e apagar o próprio comentário. Se o comentário já tem resposta de
  outra pessoa, ele vira "removido pelo autor" (`removedAt`) em vez de apagar
  as respostas dos outros.
- Ao mexer em autenticação: testar todas as rotas de admin com credencial
  inválida (cookie de leitor, token sem 2º fator, token forjado, sem login)
  e esperar 401 em todas. Em 2026-11-06 foram 67 rotas x 7 credenciais.

## Ambiente local

- `npm run dev` sobe a API na porta 3333 com o banco local e **exige o 2º
  fator** no login.
- Para testes automatizados no navegador, suba uma segunda API só para
  pegar a sessão sem 2º fator:
  `PORT=3334 NODE_ENV=development SKIP_2FA=true node server.js` e faça o login
  nela (o cookie vale para `localhost` em qualquer porta). `SKIP_2FA` não
  funciona com `NODE_ENV=production` nem na Vercel.
- `scripts/seed-test-data.js` (não versionado) cria posts `[TESTE]`;
  `--clean` remove.
