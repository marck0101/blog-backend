# Rascunhos: inventário e fila

Atualizado em 26/11/2026. Fonte: os arquivos desta pasta. Os rascunhos que só existem no painel ainda não estão aqui (a lista fica com o Marcos).

Meta: um post por segunda (rotina das 9h), sempre 3 agendados à frente. Calendário completo no plano (Claude Doc "Plano SEO, GEO e clusters", seção Calendário editorial).

## Agenda em produção (26/11/2026)

Agendados no banco de produção com `scripts/schedule-post.js` (status planned, 08:50 de Brasília; a rotina das 9h publica). Para mudar, use o painel (calendário) ou rode o script de novo.

| Data | Post | Observação |
|---|---|---|
| 30/11 | Nomenclatura de campanhas e UTM (ep. 0 da Mídia paga na prática) | sem a Figura 1: o Firebase não tem credencial no .env local; dá para subir `figura-00-nome-vira-utm.webp` pelo painel |
| 07/12 | Site rápido, seguro e encontrável (pilar) | só linka posts já publicados |
| 14/12 | Onde o funil perde mais: do clique à venda com UTM | linka o ep. 0 (no ar desde 30/11) |
| 21/12 | Automação de marketing com código (pilar) | tirei a menção ao alerta de fila curta, que ainda não está no ar |
| 28/12 | Login antes do dado | season Segurança, episódio 12 |
| 04/01 a 25/01 | Segurança é pauta de diretoria, episódios 1 a 4 (revisados, com capa) | episódios 5 a 10 agendados em março |
| 01/02 a 22/02 | Bastidores do blog: Segurança de verdade num blog pessoal, SEO e GEO, Como eu sei se um post está funcionando, Como construí o marck0101 | exportados do painel para content/painel-*, revisados (ver painel-*/post.json) |
| 01/03 a 05/04 | Segurança é pauta de diretoria, episódios 5 a 10 | revisados, com capa |
| livre | ep. 1 da Mídia paga (Google Ads do zero) entra quando os 3 prints existirem; depois pilar de Tráfego e ep. 2 | o script recusa texto com [A COMPLETAR] |

Os 18 episódios da Mídia paga e os 4 posts acima também estão como rascunho/agendados no painel de produção. PageSpeed e Clarity 2 saiu da agenda até os dados de 30 dias existirem. A tabela abaixo é o inventário anterior (as datas dela valem só como ordem).

Colunas: **palavras** (texto sem HTML) · **img** (imagens/figuras no corpo) · **links ext.** (links externos) · **links int.** (links para outros posts) · **FAQ / tags / resposta direta / capa** no post.json ou season.json.

| Semana | Arquivo | Tema | Palavra-chave principal | Palavras | Img | Links ext. | Links int. | FAQ | Tags | Resp. direta | Capa | O que falta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 30/11 | pagespeed-clarity-parte-2/content.html | site-rapido-e-encontravel | nota do PageSpeed no celular | 3835 | 1 (gerada) | 12 | 5 | sim | sim | sim | não | **revisado 26/11** (AUDITORIA.md); falta: 7 trechos [A COMPLETAR] com os dados de 30 dias, subir Figura 1 e capa |
| 07/12 | midia-paga-na-pratica/00-processo-nomenclatura-utm.html | trafego-pago-medido | padrão de nomenclatura de campanhas e UTM | 1086 | 1 (gerada) | 2 | 2 | sim | sim | sim | não | **revisado 26/11**: texto final, fontes oficiais conferidas, Figura 1; falta: 2 prints, subir figura, capa |
| 14/12 | midia-paga-na-pratica/01-google-ads-do-zero.html | trafego-pago-medido | como criar campanha no Google Ads do zero | 917 | 0 | 2 | 3 | sim | sim | sim | não | **revisado 26/11**: texto final, fontes oficiais conferidas; falta: 3 prints, capa |
| 21/12 | pilar-trafego-pago-medido/content.html | trafego-pago-medido (pilar) | tráfego pago para pequenas empresas | 1029 | 0 | 6 | 7 | sim | sim | sim | não | **escrito 26/11**: só linka o que estará no ar em 21/12 (ep. 0 e 1, season, posts publicados), 6 fontes oficiais; falta: capa e sua revisão |
| 28/12 | midia-paga-na-pratica/02-pesquisa-criar.html | trafego-pago-medido | campanha de pesquisa no Google Ads passo a passo | 980 | 0 | 6 | 3 | sim | sim | sim | não | **revisado 26/11**: texto final, 6 fontes oficiais; falta: 3 prints, conferir IA Max na interface, capa |
| 04/01 | midia-paga-na-pratica/03-pesquisa-otimizar.html | trafego-pago-medido | como otimizar campanha de pesquisa | 918 | 0 | 4 | 4 | sim | sim | sim | não | **revisado 26/11**: texto final, 4 fontes oficiais; falta: 4 prints, caminhos de menu, capa |
| 18/01 | midia-paga-na-pratica/04-performance-max.html | trafego-pago-medido | Performance Max vale a pena | 1981 | 0 | 7 | 4 | sim | sim | sim | não | **revisado 26/11**: 6 fontes oficiais conferidas (canais, especificações), resposta à palavra-chave no início; falta: período e fonte do R$ 18/R$ 12 do cliente, 7 prints, capa |
| 25/01 | funil-do-clique-a-venda-com-utm/content.html | dashboards-e-bi | como acompanhar venda pela UTM | 899 | 0 | 5 | 4 | sim | sim | sim | não | **escrito 26/11**: 5 fontes oficiais do GA4/Google Ads; falta: capa, diagrama do funil, sua revisão |
| 01/02 | midia-paga-na-pratica/05-demand-gen.html | trafego-pago-medido | campanha Demand Gen no Google Ads | 911 | 0 | 1 | 4 | sim | sim | sim | não | **revisado 26/11**: texto final, canais, 10× CPA e US$ 5/dia conferidos; falta: reconferir a migração do Display, 3 prints, capa |
| 08/02 | login-antes-do-dado/content.html | seguranca-na-diretoria (season, ep. 12) | dashboard de cliente com login seguro | 870 | 0 | 3 | 3 | sim | sim | sim | não | **escrito 26/11**: para diretoria; LGPD arts. 46 e 48, ANPD 15/2024, Verizon, NIST; falta: capa, sua revisão, season e ordem no painel |
| 15/02 | midia-paga-na-pratica/06-shopping.html (07 fundido) | trafego-pago-medido | campanha de Shopping no Google Ads | 980 | 0 | 3 | 7 | sim | sim | sim | não | **revisado 26/11**: 6 e 7 fundidos (07 removido do season.json e da pasta), 3 fontes oficiais; falta: 4 prints, conferir prioridade × Performance Max, capa |
| 22/02 | pilar-site-rapido-seguro-encontravel/content.html | site-rapido-e-encontravel (pilar) | site lento perde venda | 1100 | 0 | 7 | 8 | sim | sim | sim | não | **escrito 26/11**: hub com os 8 posts do tema, 7 fontes; falta: capa e sua revisão |
| 15/03 | pilar-engenharia-no-marketing/content.html | engenharia-no-marketing (pilar) | automação de marketing com código | 797 | 0 | 3 | 6 | sim | sim | sim | não | **escrito 26/11**: hub do tema com 6 posts, 3 fontes já conferidas; falta: capa, sua revisão e links para os posts 0101 quando existirem |
| 01/03 | midia-paga-na-pratica/08-meta-objetivos.html | trafego-pago-medido | qual objetivo escolher no Meta Ads | 306 | 0 | 4 | 0 | não | não | não | não | expandir, diagrama objetivo → resultado, FAQ, links |
| 08/03 | midia-paga-na-pratica/09-meta-leads-whatsapp.html | trafego-pago-medido | campanha de mensagens para WhatsApp no Meta Ads | 330 | 0 | 3 | 0 | não | não | não | não | expandir, termo regional, FAQ, links |
| 22/03 | midia-paga-na-pratica/10-meta-vendas.html | trafego-pago-medido | campanha de vendas no Meta Ads | 326 | 0 | 3 | 0 | não | não | não | não | expandir, FAQ, links |
| 29/03 | midia-paga-na-pratica/11-meta-trafego.html | trafego-pago-medido | campanha de tráfego no Meta Ads | 330 | 0 | 3 | 0 | não | não | não | não | expandir, FAQ, links |
| 12/04 | midia-paga-na-pratica/12-meta-reconhecimento.html | trafego-pago-medido | campanha de reconhecimento no Meta Ads | 322 | 0 | 3 | 0 | não | não | não | não | expandir, FAQ, links |
| 19/04 | midia-paga-na-pratica/13-meta-otimizacao-criativos-publicos.html + 14-meta-checklist.html | trafego-pago-medido | como testar criativos no Meta Ads | 230 + 141 | 0 | 3 | 0 | não | não | não | não | fundir, expandir, FAQ, links |
| 03/05 | midia-paga-na-pratica/15-linkedin-objetivos.html | trafego-pago-medido | LinkedIn Ads para empresa B2B | 237 | 0 | 3 | 0 | não | não | não | não | expandir, FAQ, links |
| 10/05 | midia-paga-na-pratica/16-linkedin-document-ads.html | trafego-pago-medido | Document Ads no LinkedIn | 217 | 0 | 2 | 0 | não | não | não | não | expandir, FAQ, links |
| 24/05 | midia-paga-na-pratica/17-linkedin-lead-gen.html + 18-linkedin-checklist.html | trafego-pago-medido | formulário de Lead Gen no LinkedIn | 199 + 130 | 0 | 2 | 0 | não | não | não | não | fundir, expandir, FAQ, links |

## O que o inventário mostra

- **Nenhum rascunho tem imagem, link interno, tags ou resposta direta.** Todos precisam passar pelo [checklist](_modelo/CHECKLIST.md) antes de agendar.
- **15 dos 19 episódios têm menos de 410 palavras.** Para o Google são páginas rasas; publicados assim, competem mal até pela palavra-chave longa. Cada um precisa chegar a ~700 palavras com o que só quem opera a conta sabe (o que desmarcar, o erro comum, o número de referência com fonte).
- **A season `midia-paga-na-pratica` não tem FAQ nem resposta direta** no season.json. O import (`scripts/import-season.js`) cria rascunho; os campos novos entram no season.json de cada episódio na revisão.
- **Os checklists** (07, 14, 18) viram seção final do episódio anterior: 19 arquivos, 16 posts. O 07 já foi fundido ao 06 (26/11).
- **PageSpeed e Clarity 2** é o único longo e com FAQ, mas tem 0 link externo: as referências precisam virar links (mesmo processo da parte 1).

## Rascunhos do painel fora desta pasta

(preencher com a lista do painel: título, tema, semana)

## Episódios 8 a 18 (Meta e LinkedIn): esperando você

Os 11 rascunhos estão em tópicos marcados **[A VALIDAR COM MARCOS]** (de 7 a 16 marcas cada), e 8 deles esperam o checklist da agência ("Marcos envia"). O loop não escreve texto final antes disso, para não pôr na sua boca o que você não validou.

As páginas oficiais da Meta (objetivos, fase de aprendizado, API de Conversões) só carregam no navegador, e os endereços de ajuda do LinkedIn citados nos rascunhos apontam para outros artigos ou dão 404. Ao validar, confira em especial:

- Meta: os seis objetivos (Reconhecimento, Tráfego, Engajamento, Cadastros, Promoção do app, Vendas) e em qual deles ficam as mensagens de WhatsApp na sua interface hoje.
- Meta: a regra da fase de aprendizado (cerca de 50 eventos em 7 dias por conjunto) na página "Sobre a fase de aprendizado".
- LinkedIn: os links de "objetivos de campanha" e "Document Ads" (os atuais estão errados).

Com a validação e os checklists, cada episódio leva uma rodada do loop, como os de Google.
