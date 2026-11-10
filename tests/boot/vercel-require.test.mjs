import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

// O runtime da Vercel não aceita require() de pacote só-ESM, mesmo no Node 22
// (em 09/11/2026 o sanitize-html 2.18 puxou o htmlparser2 12 e a API caiu
// inteira com ERR_REQUIRE_ESM). Aqui a API carrega com essa mesma restrição.
describe("carga da API como na Vercel", () => {
  it("sobe sem require() de módulo ESM", () => {
    const run = spawnSync(
      process.execPath,
      ["--no-experimental-require-module", "-e", "require('./api/index.js'); process.exit(0)"],
      { cwd: root, encoding: "utf8", env: { ...process.env, NODE_ENV: "test" }, timeout: 30000 }
    );
    expect(run.stderr).not.toMatch(/ERR_REQUIRE_ESM/);
    expect(run.status).toBe(0);
  });
});
