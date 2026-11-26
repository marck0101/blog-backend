# Auditoria: PageSpeed e Clarity 2 (rascunho)

Revisão de 27/11/2026 pelo [checklist](../_modelo/CHECKLIST.md). Post agendado no calendário para **30/11/2026**.
O original antes da revisão não foi versionado aqui; as mudanças estão listadas abaixo.

## Afirmações e fontes

| # | Trecho | Fonte | Situação | O que foi feito |
|---|---|---|---|---|
| 1 | Velocidade afeta conversão (Deloitte; Google, 2020) | Relatório Milliseconds make millions | Confere (verificado na parte 1: +8,4% varejo, +10,1% viagens) | Link original dava 404: trocado pela cópia do Web Archive |
| 2 | "Cada segundo a mais aumenta a chance de rejeição" (Google, 2017) | Think with Google, Daniel An | Genérico demais; o texto da fonte traz o 1→10 s | Reescrito: "+123% quando o carregamento passa de 1 para 10 s" (An, 2018), mesma forma da parte 1, link no Web Archive |
| 3 | "A maior parte das apostas feitas sem medição erra o alvo" (Kohavi; Thomke, 2017) | HBR, set./out. 2017 | O artigo fala de ideias testadas que não melhoram a métrica, não de "apostas sem medição" | Reescrito para o que o artigo diz; frase igual na conclusão também |
| 4 | LCP: imagem principal com prioridade (Google, 2020a; 2022) | web.dev optimize-lcp e fetch-priority | Confere | Links |
| 5 | Cache de 1 ano para arquivos com nome único (Google, 2018) | web.dev http-cache | Confere | Link |
| 6 | Scripts de terceiros depois da página (Google, 2019) | web.dev efficiently-load-third-party-javascript | Confere | Link |
| 7 | Imagem sem dimensões desloca o texto (Google, 2020b) | web.dev optimize-cls | Confere | Link |
| 8 | Imagens responsivas (Mozilla, [2024]) | MDN | Confere; endereço mudou | Link novo (/Guides/Responsive_images) |
| 9 | Formato /llms.txt (Howard, 2024) | llmstxt.org | Confere | Link |
| 10 | PIE (Goward, 2013) | Livro | Livro, sem link | Mantido |
| 11 | Números do blog (Lighthouse, PageSpeed, Clarity, GA4, Search Console) | Medições do autor, com data e ferramenta | Regra 4 atendida | Mantidos; Figura 1 gerada com os números da seção 7.1 |

## Referências

- **Citadas sem estar na lista:** nenhuma depois da revisão.
- **Na lista sem citação:** "GOOGLE. Web Vitals, 2024" (o autor é Philip Walton, 2020, como na parte 1) e "MICROSOFT. Clarity documentation". Ambas passaram a ser citadas onde o texto usa o conceito (7.6 e H2).
- **GOOGLE 2017** virou **AN, 2018**, igual à parte 1.
- Todas as 12 referências com endereço viraram links; a limpeza da API mantém os 17 links do texto.

## Links internos (5)

Parte 1 (no resumo) · QA antes de subir código (5.3) · Do zero ao ar (5.4) · SSR, SSG ou SPA (7.6) · Parte 3, Blog rápido e seguro (antes da conclusão).
O tema "Site rápido, seguro e encontrável" ainda não tem pilar publicado; o link entra quando ele existir (Sprint 4).

## SEO

- Palavra-chave: **nota do PageSpeed no celular**. Título novo: "PageSpeed e Clarity 2: o que melhorou a nota no celular" (55 caracteres). Slug mantido.
- `cluster`, `tags` e `directAnswer` no post.json. `plannedAt` em 30/11/2026.

## Fica com você antes de agendar

1. **Os 7 trechos [A COMPLETAR]** dependem de 30 dias de Clarity, GA4 e Search Console (a partir de 27/10, os 30 dias fecham hoje) e do PageSpeed Insights oficial com print. Sem eles o post não pode sair em 30/11: preencha até sábado ou troque a semana com o episódio 0 de Mídia paga (o calendário permite).
2. **Apagar a nota de rascunho** do topo.
3. **Subir a Figura 1** (`figura-1-antes-depois.webp`, nesta pasta) pelo painel no lugar indicado, e a capa com texto alternativo.
4. **1/3 dos experimentos na Microsoft (Kohavi; Thomke, 2017)**: a mesma pendência da parte 1 (paywall da HBR).
