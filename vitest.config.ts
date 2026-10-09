import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // Postgres embutido (WASM) com as migrações aplicadas na primeira conexão.
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "pglite://memory", JWT_SECRET: "teste-teste-teste-teste-teste-teste-123" },
    testTimeout: 60000,
    hookTimeout: 60000,
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
  },
});
