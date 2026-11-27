# Auditoria de fontes: PageSpeed e Clarity, como decido o que otimizar primeiro

- Post: https://blog.marck0101.com.br/blog/pagespeed-e-clarity-como-decido-o-que-otimizar-primeiro
- Auditado em: 26/11/2026 (plano "SEO, GEO e clusters", Sprint 2)
- Base: HTML publicado em produção (API pública), corrigido em `content.html`
- Regra: fonte aberta e diz o mesmo → mantém e linka · diz outra coisa → corrige · não encontrada → reescreve ou tira

## Resumo

- 12 referências, nenhuma com link clicável → as 8 com endereço viraram links.
- 2 endereços quebrados (Deloitte 404; Think with Google redireciona para página genérica) → trocados pela cópia no Web Archive.
- 1 citação sem referência: "(Google, 2024)" → era a página de Walton (2020), que estava na lista sem ser citada.
- 1 número que a fonte não traz no texto: "+32% de 1 para 3 s" → trocado por "+123% de 1 para 10 s", que a mesma fonte confirma.
- 2 frases reescritas para dizer só o que a fonte diz (Nielsen 28%; experimentos na Microsoft, Google e Booking).
- Números próprios (PageSpeed 53, Clarity, GA4, Search Console) mantidos: são medições do autor, com data e ferramenta.

## Afirmação por afirmação

| # | Afirmação no post | Fonte aberta | O que a fonte diz | Decisão |
|---|---|---|---|---|
| 1 | 0,1 s mais rápido → +8,4% conversões varejo, +10,1% viagens | Deloitte; Google (2020), PDF no Web Archive | "User transactions were measured to increase by 8.4% when there was a 0.1 second improvement" (varejo); "A 10.1% increase in conversion rate on mobile" (viagens); 37 marcas, 30 mi de sessões, 4 semanas | Mantida; acrescentado o tamanho do estudo; link trocado (o original dá 404) |
| 2 | De 1 para 3 s, bounce +32% | An (Think with Google), cópia no Web Archive | O texto não traz 32% (provavelmente só na imagem do artigo). Traz: "as page load time goes from one second to 10 seconds, the probability of a mobile site visitor bouncing increases 123%". Autor único (Daniel An), atualizado em fev. 2018, original de fev. 2017 | **Corrigida** para 1→10 s = +123%; referência ajustada (autor, data, link) |
| 3 | Vodafone: LCP 31% melhor → 8% mais vendas | web.dev (2021) | "a 31% improvement in LCP led to 8% more sales" (teste A/B de uma landing page) | Mantida; link ativado |
| 4 | Core Web Vitals: LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1 | Walton (2020), web.dev/articles/vitals | Confirma os três limites; autor Philip Walton | Mantida; citação "(Google, 2024)" trocada por "(Walton, 2020)" |
| 5 | INP substituiu o FID em março de 2024 | Viscomi (2024), web.dev/blog/inp-cwv-launch | "INP would become a Core Web Vital in March 2024… replacing First Input Delay" | Mantida; referência nova incluída |
| 6 | Clarity destaca rage clicks, dead clicks etc. | Microsoft ([2024]) | Documentação existe (200) | Mantida; link ativado |
| 7 | Leitura em F | Nielsen (2006) | Página existe (200) | Mantida; link ativado |
| 8 | "Em média leem no máximo 28% das palavras" | Nielsen (2008) | "users have time to read at most 28% of the words… 20% is more likely" (25 usuários, dados de 2005) | **Reescrita**: tempo para ler no máximo 28%, 20% o mais provável |
| 9 | Na Microsoft, cerca de 1/3 dos experimentos melhora a métrica | Kohavi; Thomke (2017), HBR | Página aberta; o trecho fica atrás do paywall | **Pendente**: conferir no PDF da HBR ou trocar por Kohavi; Tang; Xu (2020), cap. 1 |
| 10 | Microsoft, Google e Booking.com rodam milhares de experimentos por ano | Kohavi; Thomke (2017); Thomke (2020) | Não encontrado no texto aberto | **Removida**; Thomke (2020) saiu das referências |
| 11 | Bing: mudança nos títulos dos anúncios → +12% de receita | Kohavi; Thomke (2017) | "the change had increased revenue by an astonishing 12%" | Mantida |
| 12 | ICE "popularizado no growth hacking" | nenhuma | — | **Reescrita** sem a atribuição |
| 13 | HEART (5 dimensões), PIE (Goward, 2013), A/B como padrão-ouro | livros e anais citados | Sem link público; obras reais e citadas corretamente | Mantidas |

## Fica com você

- [ ] **Figura 1** (gráfico de barras): se ela mostra a barra de "+32%", gerar a imagem de novo com "+123% (1→10 s)" ou tirar essa barra. O texto alternativo atual continua correto.
- [ ] Afirmação 9: confirmar no PDF da HBR (ou aceitar a troca pela referência do livro).
- [ ] Aplicar o `content.html` no post publicado (script da Sprint 3, com simulação antes).
