import { defineConfig } from "vitest/config";

// Testes da API: banco MongoDB em memória (tests/setup), nunca DEV nem PROD.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
    globalSetup: ["tests/setup/global-setup.mjs"],
    setupFiles: ["tests/setup/env.mjs"],
    // Um arquivo por vez: todos usam o mesmo banco em memória
    fileParallelism: false,
    // Primeira execução baixa o binário do MongoDB
    hookTimeout: 120_000,
    testTimeout: 15_000,
  },
});
