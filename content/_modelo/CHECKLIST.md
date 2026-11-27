# Pronto para agendar

Um rascunho só vira **Agendado** no painel quando passa por todos os itens.
Complementa o [GUIA.md](GUIA.md) (como escrever) e o [RASCUNHOS.md](../RASCUNHOS.md) (a fila).
Meta da fila: um post por segunda e sempre 3 agendados à frente.

## 1. Fontes

- [ ] Cada número tem fonte e período (regra 4 do BRAND.md). Número próprio diz a ferramenta e a data da medição.
- [ ] Cada fonte foi aberta e diz o que o texto afirma. Se diz outra coisa, corrija; se não foi encontrada, reescreva ou remova.
- [ ] Toda referência com endereço é um link (`<a href>`) que abre. Link quebrado: troque pela cópia do Web Archive.
- [ ] Toda citação no texto tem a referência na lista, e toda referência da lista é citada.
- [ ] Fontes oficiais primeiro: Central de Ajuda do Google Ads, Central de Ajuda para Empresas da Meta, LinkedIn Marketing Solutions, web.dev.

## 2. Tema e links internos

- [ ] `cluster` definido no post.json (ou no season.json) com um slug de `app/config/clusters.js`.
- [ ] Link para o pilar do tema (quando o pilar já estiver publicado).
- [ ] Mais 2 a 4 links para outros posts, no meio do texto e com âncora que diz o assunto (nada de "clique aqui").
- [ ] Episódio de season: link para o anterior e, quando publicado, para o próximo.
- [ ] Sem repetir o assunto de outro post: se outro post já é o dono do tema, resuma em uma frase e linke.

## 3. Palavra-chave

- [ ] Uma palavra-chave principal, a da tabela do RASCUNHOS.md, que nenhum outro post usa.
- [ ] Ela aparece no `title` (no começo), no `slug`, em um H2 e no primeiro parágrafo.
- [ ] Termo regional quando fizer sentido (noroeste do RS, pequenas e médias empresas, agências), sem forçar.
- [ ] `directAnswer` (até 400 caracteres): a resposta para a palavra-chave, que faça sentido fora do artigo.
- [ ] `tags`: 3 a 5, minúsculas.
- [ ] `faq`: 3 a 5 perguntas como a pessoa digita na busca.

## 4. Imagens

- [ ] Capa com texto alternativo descritivo (no painel).
- [ ] Uma imagem ou diagrama onde ajuda a entender (fluxo, antes/depois, tela). Diagramas o loop gera; prints das plataformas são do Marcos.
- [ ] Print sem dado de cliente, e-mail, nome ou valor que não possa ser público.
- [ ] Imagens em WebP com largura e altura definidas (o editor gera as variações).

## 5. Tamanho e forma

- [ ] Pelo menos ~700 palavras com o que só quem opera sabe: o que desmarcar, o erro comum, o número de referência com fonte. Texto curto demais compete mal até pela palavra-chave longa.
- [ ] Checklists curtos viram seção final do post anterior em vez de post próprio.
- [ ] Nenhum [A COMPLETAR] e nenhuma nota de rascunho sobrando.
- [ ] `excerpt` até 160 caracteres, `title` até 60.

## 6. Agendar

- [ ] `plannedAt` com a segunda da semana no calendário (9h é a rotina; a data vale a partir do dia seguinte se a rotina de hoje já rodou).
- [ ] Importar como rascunho (`node scripts/import-draft.js content/<slug> --apply`, ou `import-season.js` para season), conferir no painel e trocar para Agendado.
- [ ] Depois de publicar: sitemap, /llms.txt, PageSpeed no celular acima de 90 e pedido de indexação no Search Console.
