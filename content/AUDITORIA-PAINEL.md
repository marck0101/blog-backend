# Auditoria: rascunhos avulsos que só existiam no painel (26/11/2026)

Exportados de produção para `content/painel-*` (content.html + post.json). "Proposta e desenvolvimento do blog" é uma lista de ideias do autor, não um post, e ficou só no painel.

| Post | O que mudou |
|---|---|
| Segurança de verdade num blog pessoal | Reescrito a partir do código atual: o rascunho dizia que o 2FA estava "em teste", mas ele é obrigatório (TOTP + 10 códigos de recuperação). Entraram login com Google, limite de 10 tentativas em 15 min, cookie httpOnly de 7 dias, "sair" que encerra todas as sessões, limite de 5 pedidos de recuperação por hora. Fontes: NIST 800-63B-4, OWASP Top 10 2025, Verizon 2025, LGPD. Título e FAQ atualizados |
| SEO, GEO e os detalhes invisíveis | "2FA em teste" corrigido; "GEO é a versão 2026 do SEO" virou uma definição sem promessa, com o aviso do Google sobre o /llms.txt; a frase "o buscador consegue indexar as combinações de filtro" estava errada (as URLs filtradas têm canonical para /blog). Fontes do Google e links para SSR/SSG/SPA, Perguntas e o pilar de Site |
| Como eu sei se um post está funcionando | Recursos conferidos no código (contador de visualizações, busca interna agregada, período de 1 a 365 dias). Fontes do Search Console e do Clarity; links para PageSpeed e Clarity e para o funil por UTM |
| Como construí o marck0101 | Link quebrado para o "Do zero ao ar" corrigido (slug mudou); "2FA em teste" corrigido; link para o pilar de Site |

Agendados de 01/02 a 22/02/2027, na ordem da série original, depois dos posts que eles linkam.
