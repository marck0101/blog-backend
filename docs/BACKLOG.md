# Backlog — API (node-express-mongodb)

Pendências conhecidas da API, com o contexto de cada uma. O backlog do front
fica em `Front Admin/blog-panel/docs/BACKLOG.md`; o de SEO/GEO editorial, na
planilha "Plano ICE - SEO e GEO blog.marck0101.com.br" (Google Drive).

Ao resolver um item, apague-o daqui no mesmo commit da correção.

Prioridade: **alta** (afeta usuário ou dado agora) · **média** (melhora real,
sem urgência) · **baixa** (higiene, monitorar).

---

## Média — Uma fonte só para o FAQ do blog

**O que é:** o FAQ da home (`BLOG_FAQ`) e o da página `/seasons`
(`SEASONS_FAQ`) existem em dois lugares: no front
(`src/seo/site.js`, que alimenta a página e o schema FAQPage) e numa cópia
aqui (`app/config/siteFaq.js`, que alimenta o `/llms-full.txt`).

**Por que importa:** se alguém mudar um e esquecer o outro, a IA lê um FAQ
diferente do que o site mostra. Os dois arquivos têm um aviso, mas aviso não
impede o erro.

**Caminho sugerido:** a API passa a ser a dona do texto (ex.: rota
`GET /api/site/faq` ou campo editável no painel) e o front e o prerender
consomem de lá. Dá para começar só pela API servindo `siteFaq.js` e o front
lendo no build.

## Baixa — Tamanho do `/llms-full.txt`

**O que é:** o arquivo tem o texto integral de todos os posts publicados e
cresce cerca de 10 KB por post (114 KB com 10 posts, em 2026-11-06).

**Por que importa:** a Vercel limita a resposta de uma função a 4,5 MB. No
ritmo de 2 posts por semana, o limite chega perto de ~400 posts (anos), mas
quando chegar a rota quebra inteira.

**Caminho sugerido:** quando passar de ~2 MB, gerar o arquivo estático no
deploy/publicação (Storage ou Blob) ou dividir por ano (`/llms-full-2026.txt`)
e listar as partes no `/llms.txt`. Código em `app/routes/sitemap.routes.js`.

## Baixa — Vulnerabilidade moderada em `uuid` (via firebase-admin)

**O que é:** `npm audit --omit=dev` aponta 7 avisos moderados, todos do
`uuid@9` que vem do `firebase-admin` (`@google-cloud/firestore` e
`@google-cloud/storage`). Não usamos `uuid` diretamente.

**Por que importa:** baixo risco hoje (o problema é em `buf` passado pelo
chamador, que o nosso código não faz), mas some sozinho ao atualizar.

**Caminho sugerido:** atualizar o `firebase-admin` quando sair versão com
`uuid` corrigido. Não rodar `npm audit fix --force` (troca versões
principais e pode quebrar o upload de imagens).

## Baixa — Conferir se `scripts/fix-updated-at.js` rodou em produção

**O que é:** até 2026-10-09 cada visualização alterava o `updatedAt` do post
(bug já corrigido). O script volta o `updatedAt` dos posts publicados para a
data de publicação.

**Situação em 2026-11-06:** o sitemap de produção mostra datas variadas
(não são todas do dia da última visita), então o bug não está mais
acontecendo. Não dá para saber de fora se o script foi aplicado.

**Como conferir:** `NODE_ENV=production node scripts/fix-updated-at.js`
(sem `--apply` só mostra o que mudaria). Se não listar nada, apague este item.
