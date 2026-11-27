// Gera amostras da capa automática (claro/escuro x título curto/longo).
// Uso: node scripts/gen-cover-samples.js [pasta]   (padrão: ./capas-amostra)
const fs = require("fs");
const path = require("path");
const { renderCoverPng } = require("../app/services/coverCard.service");

const out = path.resolve(process.argv[2] || "capas-amostra");
fs.mkdirSync(out, { recursive: true });

const SHORT = "Tag Manager sem achismo";
const LONG =
  "Conferência de Tag Manager antes de confiar nos números: o que eu checo em cada conta antes de ligar o primeiro real em tráfego pago";
const base = { category: "Tráfego", date: "2026-11-27T15:00:00Z" };

(async () => {
  for (const theme of ["claro", "escuro"]) {
    for (const [name, title] of [["curto", SHORT], ["longo", LONG]]) {
      const file = path.join(out, `capa-${theme}-${name}.png`);
      fs.writeFileSync(file, await renderCoverPng({ ...base, title, theme }));
      console.log(file);
    }
  }
})();
