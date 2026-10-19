import { defineConfig } from "vitest/config";

// The data-layer mappers are pure TypeScript, so they're tested with plain
// Vitest rather than through the Astro/Cloudflare Vite pipeline.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
