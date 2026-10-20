import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";
import { withVerifiedSsl } from "./src/db/url";

// Locally the Neon env lives in `.env.local` (`neon env pull`); in CI the
// variable comes from the environment instead.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Migrations use the direct (non-pooled) connection, per Neon guidance.
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED is not set. Run `neon env pull` to fetch it.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: { url: withVerifiedSsl(url) },
  strict: true,
  verbose: true,
});
