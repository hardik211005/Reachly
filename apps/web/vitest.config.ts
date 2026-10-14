import { defineConfig } from "vitest/config";

// Unit tests only; Playwright specs in e2e/ run via `npm run test:e2e`.
export default defineConfig({
  test: {
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", ".next/**", ".next-e2e/**", "e2e/**", "test-results/**"],
    passWithNoTests: true,
  },
});
