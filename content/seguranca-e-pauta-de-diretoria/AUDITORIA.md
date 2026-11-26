# Auditoria: série Segurança é pauta de diretoria (episódios 1–10)

Os 10 episódios estavam só no painel de produção, como rascunho e com capa. Exportados em 26/11/2026 para esta pasta (`NN-*.html` + `season.json`), que passa a ser a fonte para revisão. O episódio 11 é o caso Binance (publicado) e o 12 é "Login antes do dado" (agendado para 28/12).

Padrão aplicado em cada episódio: fontes abertas e conferidas, referências no formato ABNT com citação no texto, sem `nofollow`, link para posts já publicados (nunca para episódio ainda não publicado) e uma menção ao noroeste do RS.

| Ep. | Situação | O que mudou |
|---|---|---|
| 1 | revisado | Caso Lapsus$/ConecteSUS conferido (Poder360, Tecnoblog, relatório do CSRB de 2023). "Nvidia e Samsung" saíram: as fontes citam Microsoft e Uber. Links para Binance e Dashboards com IA |
| 2 | revisado | Caso C&M: "ataque ao PIX" corrigido (o PIX não foi invadido, segundo a ESET); "BC suspendeu" virou "bloqueou preventivamente as comunicações", como diz a fonte; LGPD art. 52 citada. Link para Dashboards com IA |
| 3 | revisado | Caso Arup conferido na CNN (HK$ 200 mi ≈ US$ 25,6 mi, 15 transferências); fonte trocada do espelho abc17news (403) para a CNN; "etapa 4/etapa 2" explicado pela Figura 2. Link para Binance |
| 4 | revisado | Caso MGM conferido (Baguete: LinkedIn + help desk, US$ 100 mi + US$ 10 mi); "10 minutos" saiu do título (nenhuma fonte aberta confirma); fonte de fornecedor (Adaptive) removida; estudo dos pendrives conferido (48%, menos de 6 min). Link para Dashboards com IA |
| 5 | revisado | Colonial Pipeline conferido (Dark Reading, TechRadar: senha complexa, mas reaproveitada); BankInfoSecurity removido (bloqueia acesso); DBIR genérico trocado pelo dado de 22% da Verizon 2025; NIST 800-63B-4 acrescentado. Links para Blog rápido e Binance |
| 6 | revisado | Toyota conferido (Security Affairs, Infosecurity, GitGuardian: 296.019 clientes, dez. 2017 a set. 2022). Links para Do zero ao ar (.env fora do Git) e Blog rápido |
| 7 | revisado | JBS (US$ 11 mi de US$ 22,5 mi pedidos) e Maersk (US$ 300 mi; controlador de domínio em Gana salvo por queda de energia) conferidos; Food Processing removido (bloqueia acesso), Wired acrescentado. Link para Binance (prazo da ANPD) |
| 8 | revisado | Equifax: "semanas depois" virou "cerca de dois meses depois"; 147 mi e US$ 1,38 bi conferidos. Links para Blog rápido (bibliotecas com falha conhecida) e QA |
| 9 | revisado | Uber conferido (Dark Reading, InfoQ); Aurora → BeyondCorp suavizado ("nos anos seguintes") e o artigo original do Google citado; CISA ZTMM 2.0. Links para Binance e Dashboards com IA |
| 10 | revisado | Deixou de ser "conclusão da season" (a série segue com Binance, ep. 11, e Login antes do dado, ep. 12); Verizon 2025 (60% elemento humano, terceiros 30%) e relatório do NYDFS sobre o Twitter citados. Link para Binance |

Metadados no season.json: tema seguranca-na-diretoria, 4 tags e resposta direta (o "Em resumo" de cada episódio). Aplicado nos rascunhos de produção com import-season --update (capas mantidas). Episódios 1 a 4 agendados de 04/01 a 25/01/2027; 5 a 10 ficam prontos como rascunho.
