# Auditoria: os 6 posts restantes (26/11/2026)

Último item da Sprint 2. Base: o HTML publicado de cada post. Cada pasta `content/<slug>/` tem agora o `content.html` publicado com as correções abaixo; vão para o banco pelo script da Sprint 3 (`--dry-run` primeiro). Tags e resposta direta, que **nenhum dos 6 tem**, ficam para a Sprint 3 ("resposta direta e tags nos 9 posts").

| Post | Palavras | Links antes → depois | Achados | O que foi feito |
|---|---|---|---|---|
| Perguntas que todo mundo faz sobre blogs | 806 | 0 → 5 | **Afirmação errada:** "sem robots.txt, um buscador pode indexar a tela de login". O robots.txt controla rastreamento, não indexação (o próprio Google diz isso), e contradiz o que o blog ensina em Dashboards com IA e Blog rápido e seguro | Reescrito, com a diferença entre robots.txt e noindex e 2 referências do Google Search Central; "Leia também" com 3 posts |
| SSR, SSG ou SPA | 2308 | 13 → 14 | 6 links internos absolutos com `nofollow` e nova aba; todos os 7 externos abrem | Links internos viraram relativos, sem `nofollow`; link novo para Monólito ou dois repositórios |
| Monólito ou dois repositórios | 2036 | 6 → 9 | 6 referências externas com link, todas abrem (Fowler ×3, InfoQ, MDN com endereço novo, V8). Sem afirmação sem fonte | "Leia também" com 3 posts |
| Calendário, lixeira e newsletter | 1461 | 0 → 4 | A referência da LGPD não tinha link | Link da Câmara (abre); "Leia também" com 3 posts |
| QA antes de subir código | 739 | 0 → 3 | Sem fontes externas (relato do autor). **Redundância** leve com Do zero ao ar (separação dos bancos de dev e produção) | "Leia também" apontando para Do zero ao ar, que fica dono do assunto infraestrutura |
| Do zero ao ar | 841 | 0 → 3 | Sem fontes externas (relato) | "Leia também" com 3 posts |

## Observações

- **Monólito:** os links externos usam `nofollow`. Para referências de autoridade (Martin Fowler, MDN) não é necessário; fica a seu critério.
- **Série técnica (Do zero ao ar → Fred Brooks → Monólito → … → QA):** os posts falam em "próximo post" e "post anterior" sem link. A navegação da season resolve isso se eles virarem uma season; hoje não são. Vale decidir na Sprint 3 se viram a season "Como construí o marck0101".
