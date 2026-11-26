# Auditoria: Blog rápido e seguro (publicado em 09/11/2026)

Revisão de 27/11/2026. Base: o HTML publicado (API pública), não o rascunho antigo em `content/seguranca-seo-monitoramento-parte-3/`.
O `content.html` desta pasta é o publicado com as correções abaixo; vai para o banco pelo script da Sprint 3 (`--dry-run` primeiro).

## Citações × referências

18 citações no texto, 18 referências. Todas as citações têm referência e todas as referências são citadas (CORRÊA, 2026 é citada pelo link no texto).

## Afirmações e fontes

| # | Trecho | Fonte | Situação | O que foi feito |
|---|---|---|---|---|
| 1 | LGPD trata e-mail como dado pessoal e exige segurança (Brasil, 2018) | Lei 13.709, art. 5º, I e art. 46 | Confere | Link mantido (o site do Planalto não respondeu ao teste automático; é o endereço oficial) |
| 2 | Prioridade: o que afeta todos primeiro (Goward, 2013) | Livro | Mantido | Sem link |
| 3 | Categorias do OWASP Top 10 (OWASP Foundation, 2021) | owasp.org/Top10 | Confere (redireciona para top10.owasp.org) | Link |
| 4 | npm audit (npm, 2024) | docs.npmjs.com | Confere | Link |
| 5 | noindex no painel (Google, 2024a) | Search Central, robots meta tag | Confere | Link |
| 6 | Dados estruturados FAQPage (Google, 2024b) | Search Central | **Documentação removida em jun. 2026**: o Google deixou de mostrar o resultado em FAQ em maio de 2026. O link já redirecionava na data de acesso citada (28 out.) | Link trocado pela cópia do Web Archive (mar. 2026); frase de atualização na seção 5.3 citando o changelog (Google, 2026); item do roteiro 9.4 reescrito |
| 7 | LCP, cache, CLS, scripts de terceiros (Google, 2018/2019/2020a/2020b/2022) | web.dev | Confere | Links |
| 8 | Imagens responsivas e CSP (Mozilla, 2024a/b) | MDN | Confere; endereços mudaram | Links novos (/Guides/) |
| 9 | Cabeçalhos de segurança (OWASP Foundation, 2024) | Secure Headers Project | Confere; endereço mudou | Link novo |
| 10 | Contraste mínimo 4,5:1 (W3C, 2023) | WCAG 2.2, critério 1.4.3 | Confere | Link |
| 11 | Alertar sobre o que afeta o usuário (Beyer et al., 2016) | Livro SRE do Google | Confere com a ideia do capítulo de monitoramento | Sem link |
| 12 | Limiares LCP 2,5 s, CLS 0,1, INP 200 ms (Google, 2024c) | Web Vitals | Confere; autor é Philip Walton, 2020 | Citação e referência viraram WALTON, 2020, como nos outros posts |
| 13 | Notas 53 → 94, 80 → 99, 23 → 7 vulnerabilidades, testes locais | Medições do autor, com ferramenta e data | Regra 4 atendida | Mantidos |

## Links

- O link para a parte 1 era absoluto e com `nofollow` (link interno não deve ter): virou relativo, sem `nofollow`.
- 3 links internos novos: caso Binance (7.1), calendário, lixeira e newsletter (7.2), QA antes de subir código (9.5). Total: 4.
- 17 referências com endereço viraram links. A limpeza da API mantém os 21 links.

## Redundância (decisão sua)

As seções 6.1 a 6.7 deste post repetem quase palavra por palavra as intervenções 6.1 a 6.9 de **PageSpeed e Clarity 2**, que ainda não foi publicado. Pela regra "um post é o dono do assunto":

- **Recomendação:** o dono das intervenções de desempenho é a parte 2 (é o assunto do título dela). Quando a parte 2 for ao ar, a seção 6 daqui vira um resumo de um parágrafo com os números e o link para a parte 2. Este post fica dono de segurança, SEO técnico e roteiro de monitoramento.
- Não apliquei agora porque a parte 2 ainda não está publicada: cortar antes deixaria o leitor sem o conteúdo.

## Achado para o plano (GEO)

Em 15/06/2026 o Google acrescentou ao guia de otimização para IA que o /llms.txt não é usado pela Busca do Google e não ajuda nem atrapalha a visibilidade (Google Search Central, "Latest documentation updates"). O arquivo continua útil para outros assistentes. Nenhum post deve prometer que o /llms.txt melhora posição no Google.

## SEO

`cluster: site-rapido-e-encontravel` e `directAnswer` (o post não tinha) no post.json. Tags e FAQ já existiam.

## Achado de 27/11: placeholder no ar

O post **publicado** tem um trecho a completar visível para o leitor, na seção 9.1: "um monitor externo gratuito verifica a cada 5 minutos (...) **[A COMPLETAR: ferramenta escolhida.]**". O `scripts/update-published.js` recusa esta pasta até o trecho ser preenchido com o nome da ferramenta (ou a frase ser reescrita sem ela).
