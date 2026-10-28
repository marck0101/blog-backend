# Guia para começar um artigo

Copie esta pasta (`content/_modelo`) para `content/<nome-do-post>`, preencha `post.json` e
`content.html` e importe como rascunho:

```powershell
node scripts/import-draft.js content/<nome-do-post>                 # simula no banco DEV
node scripts/import-draft.js content/<nome-do-post> --prod          # simula em produção
node scripts/import-draft.js content/<nome-do-post> --prod --apply  # grava o rascunho
```

---

## 1. Antes de escrever: responda em uma linha cada

| Pergunta | Exemplo |
|---|---|
| **Qual é a dor?** O problema que tira o sono de alguém. | "Meu site é lento e eu perco cliente sem saber." |
| **Quem sente essa dor?** | Dono de e-commerce, gestor de marketing, dev júnior. |
| **Quem mais vai ler sem ser técnico?** | O SEO da empresa, um recrutador, um cliente em potencial. |
| **Qual é a moral da história?** A frase que a pessoa repete depois de ler. | "Medir uma vez não basta." |
| **O que a pessoa consegue fazer depois de ler?** | Rodar o PageSpeed três vezes e olhar a mediana. |
| **Por que eu tenho autoridade para falar disso?** | Dado real do meu projeto, erro que eu cometi, resultado medido. |

Se alguma resposta ficar vaga, o artigo ainda não está pronto para começar.

## 2. Dor latente ou paixão ardente

Ninguém muda de hábito por um argumento morno. A pessoa age quando:

- **sente uma dor latente**: perde dinheiro, perde cliente, passa vergonha, perde tempo; ou
- **tem uma paixão ardente**: quer crescer, quer ser reconhecida, quer construir algo melhor.

Regras práticas:

- **Abra pela dor, não pela solução.** A primeira tela do artigo descreve o problema como o
  leitor sente, com um número ou uma cena concreta ("53% das pessoas desistem de um site que
  demora mais de 3 segundos").
- **Mostre o custo de não resolver.** Quanto custa deixar como está, em dinheiro, tempo ou reputação.
- **Só depois apresente o caminho.** E deixe claro que você já percorreu esse caminho (dados,
  prints, antes e depois).

## 3. Escreva para dois leitores ao mesmo tempo

O mesmo texto precisa servir ao técnico e a quem não é técnico (SEO de uma empresa, recrutador,
cliente). O técnico quer o "como"; o não técnico quer entender que **você sabe o caminho para a
solução**.

- **Toda explicação técnica ganha uma comparação simples logo em seguida.**
  - Cache → "é como deixar o café já passado na garrafa térmica: quem chega não espera passar de novo."
  - CLS → "é o botão que muda de lugar na hora em que você vai clicar."
  - Dependência vulnerável → "é trancar a porta da frente e deixar a janela do vizinho aberta para dentro de casa."
  - Monitoramento → "é o check-up anual: não espera a dor aparecer para olhar."
- **Use jargão de propósito, e traduza.** O termo técnico mostra domínio e ajuda no SEO; a
  tradução entre parênteses ou na frase seguinte mantém o leigo junto.
  Ex.: "o LCP (o tempo até o maior conteúdo aparecer na tela) caiu de 7 para 2,5 segundos."
- **Feche cada seção com uma frase de "moral da história"**, em linguagem de conversa.
- **Números sempre com contexto**: "de 72 para 94" vale mais que "94".

## 4. Estrutura do artigo

Use os títulos abaixo (eles já estão no `content.html` deste modelo):

1. **Resumo**: o problema, o que foi feito, o resultado principal em números. 3 a 5 frases.
2. **Palavras-chave**: 4 a 7, separadas por ponto e vírgula.
3. **Introdução**: abre pela dor (seção 2 deste guia).
4. **Justificativa (por quê)**: por que isso importa agora; cite estudos ou dados.
5. **Público-alvo e escopo**:
   - **Para quem**: quem sente a dor e quem mais se beneficia;
   - **Onde**: em que sistema, página ou contexto;
   - **Quando**: datas das medições e do período analisado.
6. **Hipóteses**: o que você esperava, com a situação de cada uma (confirmada, refutada, não testada).
7. **Metodologia (como)**: como mediu, com que ferramentas, quantas vezes.
8. **Intervenções**: para cada mudança, **Problema → Como → Por que → Para quem → Resultado**.
9. **Resultados e discussão**: números antes e depois; **o que deu certo**; **o que não deu certo**
   (é a parte que mais gera confiança); limitações; próximos passos.
10. **Conclusão**: a moral da história em duas ou três frases, para o leitor não técnico.
11. **Referências**: ABNT, com data de acesso.

Para um artigo de opinião ou mais curto, mantenha pelo menos: dor → por quê → para quem →
como → o que deu certo e o que não deu → conclusão → referências.

## 5. FAQ (3 a 5 perguntas)

O FAQ aparece no fim do post e vira dados estruturados (FAQPage) para o Google e para as IAs.

- **Perguntas como as pessoas digitam na busca**: "Por que meu site é lento no celular?", e não
  "Considerações sobre desempenho".
- **Uma pergunta para cada leitor**: uma técnica, uma de negócio ("quanto custa não resolver?"),
  uma de "por onde começo?".
- **Resposta autossuficiente** em 2 a 4 frases: precisa fazer sentido sozinha, fora do artigo.
- **Responda a dúvida, não repita o texto.** Pense no que a pessoa perguntaria depois de ler.

## 6. SEO do post (`post.json`)

- [ ] `title` com até 60 caracteres, com a palavra-chave principal no começo.
- [ ] `excerpt` com até 160 caracteres (o script recusa acima disso), com a dor e o resultado.
- [ ] `slug` curto, sem acento, com a palavra-chave.
- [ ] `category` válida: tecnologia, design, carreira, negocios, marketing, trafego ou growth.
- [ ] `faq` com 3 a 5 perguntas.
- [ ] `plannedAt` com a data do calendário editorial (ou remova a linha para deixar sem data).
- [ ] Capa com texto alternativo descritivo (no painel).

## 7. Formato do `content.html`

- O editor aceita: `p`, `h2`, `h3`, `strong`, `em`, `ul`, `ol`, `li`, `a`, `img`.
  **Não use tabelas**: o editor não tem suporte e elas se perdem.
- Parágrafos curtos (até 4 linhas no celular). Subtítulos que dizem o que vem, não só o tema.
- Marque o que falta com **[A COMPLETAR]** e deixe uma nota de rascunho no topo.

## 8. Cuidados

- **Segurança**: nunca detalhe uma falha que ainda não foi corrigida. Descreva de forma genérica e
  complete depois da correção.
- **Dados**: sem e-mail, nome ou dado pessoal de leitor ou assinante, nem em print.
- **Honestidade**: número de laboratório é de laboratório; diga quando for uma única medição.

## 9. Checklist final antes de publicar

- [ ] A primeira tela fala da dor de quem lê.
- [ ] Uma pessoa não técnica entende a moral da história lendo só o resumo e a conclusão.
- [ ] Cada termo técnico tem uma comparação ou tradução.
- [ ] Há "o que não deu certo".
- [ ] FAQ com perguntas reais e respostas autossuficientes.
- [ ] Nenhum [A COMPLETAR] e nenhuma nota de rascunho sobrando.
- [ ] Referências com data de acesso.
- [ ] Depois de publicar: o post aparece no sitemap e no /llms.txt, PageSpeed no celular acima
      de 90 e pedido de indexação no Search Console.
