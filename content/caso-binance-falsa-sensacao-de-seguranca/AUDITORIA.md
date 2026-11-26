# Auditoria: Caso Binance (publicado, season Segurança é pauta de diretoria)

Revisão de 26/11/2026. Base: o HTML publicado (API pública). O `content.html` desta pasta é o publicado com as correções abaixo; vai para o banco pelo script da Sprint 3 (`--dry-run` primeiro).

**Resultado:** post bem fundamentado. Os 11 números conferidos batem com as fontes; os 20 links externos respondem (inclusive o The Block, que antes dava 403 para robôs: com navegador comum abre). As correções são de forma.

## Afirmações e fontes

| # | Trecho | Fonte | Situação |
|---|---|---|---|
| 1 | US$ 6,3 bi, maior parte em ~20 minutos, FBI atribui à Coreia do Norte | CNN Brasil (Banerjee; Wee; Westbrook, 30/10) e CNN Brasil (FBI…, 1/11) | Confere ("a maior parte do roubo ocorreu em cerca de 20 minutos") |
| 2 | Horizonte de tarefa dobra a cada ~7 meses desde 2019, ~3 meses desde 2024 | METR, Time horizon 1.1 (29/01/2026) | Confere: 196 dias (7 meses) e 89 dias desde 2024 |
| 3 | GPT-4 ~3,5 min; Opus 4.5 ~320 min; quase 90× | METR, tabela TH1.1 | Confere (GPT-4 0314: 3,5; Opus 4.5: 320). **Ajuste:** o intervalo de confiança é largo (170 a 729 min); agora está no texto |
| 4 | 84% usam ou planejam usar IA (76% em 2024); 51% dos profissionais usam todo dia | Stack Overflow Developer Survey 2025 | Confere |
| 5 | Hacks de cripto: US$ 3,4 bi em 2025 | The Block / Chainalysis | Confere (título da matéria) |
| 6 | Não foi phishing simples; ataque de vários meses contra centenas de funcionários | Help Net Security, citando o relatório da Binance e Changpeng Zhao | Confere ("multi month/year attack targeting hundreds of employees") |
| 7 | 57 tentativas ligadas à Coreia do Norte em 2026 | Fortune | Confere |
| 8 | Fundo de proteção de US$ 1 bi cobria menos de 1/6 | CNN Brasil (reserva de US$ 1 bi) | Confere (1 / 6,3) |
| 9 | Credenciais roubadas: vetor inicial em 22%; só 49% das senhas diferentes | Verizon, pesquisa complementar ao DBIR 2025 | Confere |
| 10 | NIST: mínimo 15 caracteres com fator único, 8 com segundo fator, aceitar 64+ | NIST SP 800-63B-4 | Confere (SHALL 15, SHALL 8, SHOULD 64) |
| 11 | ANPD: comunicar incidente em até 3 dias úteis | Resolução CD/ANPD nº 15/2024 | Confere com o regulamento; a referência **não tem link** (o Diário Oficial não respondeu ao teste). Se quiser, acrescente o link do DOU ou da página da ANPD |
| 12 | Polícia Civil de SP: 22 mil credenciais por US$ 40 mil, alegação não confirmada | Oficina da Net e SINDPD | O texto já trata como alegação; mantido |
| 13 | Relatório da dark web do Google descontinuado no início de 2026 | Android Central, 15/12/2025 | Mantido |

## Links

- O link interno para "Dashboards com IA" abria em nova aba com `nofollow` (link interno não deve ter): virou link comum.
- 2 links internos novos, no início de "Boas práticas como desenvolvedor": Blog rápido e seguro e QA antes de subir código. Total: 3.
- A limpeza da API mantém os 23 links.

## SEO

- `cluster: seguranca-na-diretoria` no post.json. Tags, FAQ (3) e resposta direta já existiam.
- O pilar do tema é a própria season "Segurança é pauta de diretoria" (Sprint 4); quando a página do tema existir, o post já aparece nela pelo cluster.

## Atualidade

O post é de 12/11 e fala de um caso em andamento. Vale revisar em dezembro se a Binance publicou o relatório final ou se os valores mudaram, e acrescentar uma linha de atualização com data.
