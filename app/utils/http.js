// Formato único de erro da API (DUP-01): { error: "texto para a pessoa" }.
//
// Login, sessão e limite de tentativas também repetem o texto em `message`:
// o painel de antes da DUP-01 lia `message` nessas telas e pode estar no ar
// durante o deploy (o backend sobe primeiro). Remover o `message` depois que o
// front novo estiver publicado (ver docs/BACKLOG.md, DUP-01).
const errorBody = (text) => ({ error: text, message: text });

module.exports = { errorBody };
