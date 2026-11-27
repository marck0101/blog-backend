# Capa automática dos posts (Sprint R6)

Capa 1200x630 no padrão "Relatório" da marca, gerada a partir de título, categoria (ou tema/cluster) e data.
Serve de capa e de `og:image` **só quando o post não tem capa própria**. Quem tem `coverImage` nunca é sobrescrito.

## Como usar

- Endpoint público: `GET /api/posts/slug/:slug/cover.png?tema=claro|escuro` (padrão `claro`).
  - Post publicado sem capa: devolve PNG.
  - Post com `coverImage`: `302` para a capa dele.
  - Rascunho, agendado, lixeira ou slug inexistente: `404`.
- O front (`blog-front`) usa essa URL quando `post.coverImage` está vazio (og:image, JSON-LD e card).
- Amostras locais: `node scripts/gen-cover-samples.js <pasta>` gera claro/escuro x título curto/longo.
- Mudou título, categoria ou data do post: a capa muda sozinha (cache da CDN dura até 1 dia).

## Decisões

| Decisão | Escolha | Por quê |
|---|---|---|
| Quando gerar | Endpoint com cache, não no build nem ao salvar | Sem passo extra no deploy, sem armazenar arquivo, sem backfill: post novo e título editado funcionam na hora. A CDN da Vercel (`s-maxage` 1 dia + `stale-while-revalidate`) absorve o tráfego; o servidor só desenha uma vez por post/tema. |
| Como desenhar | Texto vira `<path>` (opentype.js) e o `sharp` (já usado nas capas enviadas) rasteriza o SVG em PNG | Função serverless não tem fontes instaladas e o librsvg não carrega `@font-face`. Com caminhos vetoriais as fontes da marca saem idênticas em qualquer máquina. Evita `satori`/`resvg`/canvas (dezenas de MB). Única dependência nova: `opentype.js` (~100 KB). |
| Segurança do texto | O SVG não tem `<text>`: só `<path>`/`<rect>` | Título com `<`, `&`, aspas ou tag não tem como virar marcação. Caracteres sem glifo (emoji) são removidos. |
| Formato | PNG | LinkedIn, Facebook e WhatsApp não aceitam SVG em `og:image`. |
| Fontes | `app/assets/fonts` (woff, subset latin, licença OFL): Fraunces SemiBold, IBM Plex Mono 400/500, IBM Plex Sans 400 | `vercel.json` inclui `app/assets/**` no bundle da função. |
| Qual tema | Claro por padrão; `?tema=escuro` opcional | Mesmo conteúdo, só a roupa muda (BRAND.md, seção 6). |

## Layout

- Fundo papel `#F4F1EA` + tinta `#1C2733` (claro) ou fundo tinta + texto papel (escuro). Destaque tijolo `#D9542B` só no traço acima do rótulo e no ponto da marca.
- Marca "m." (quadrado com "m" em Fraunces e ponto tijolo) + `marck0101` em IBM Plex Mono. No tema escuro o quadrado inverte (papel com "m" tinta) para não sumir no fundo.
- Rótulo em Plex Mono caixa alta: `CATEGORIA · 27 NOV 2026` (data em Brasília). Se o post tem tema (cluster), o título do tema substitui a categoria. Rótulo longo é cortado com reticências, a data nunca.
- Título em Fraunces SemiBold, 72/64/56 px: usa o maior tamanho que cabe em 3 linhas; se não cabe, a 3ª linha termina com reticências.
- Não há degradê, cor de semáforo, "fig. NN", emoji nem número que não venha do post.

## Testes

`tests/utils/coverCard.test.mjs` (gerador: quebra de linha, acentos, escape, tema, data, PNG) e `tests/posts/cover.test.mjs` (rota: PNG, redirecionamento para capa própria, 404).

## Limites conhecidos

- Só subset latin das fontes: letras fora do alfabeto latino são removidas do título.
- O cache em memória (50 itens) some quando a função reinicia; a CDN cobre.
