// @ts-check
import { defineConfig, envField } from "astro/config";

import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  site: "https://eayltaskmaster.co.uk",
  // Every page is rendered on request so admin edits show up immediately.
  output: "server",
  // No Astro sessions or image transforms are used, so skip provisioning the
  // KV namespace and Images binding the adapter would otherwise add.
  adapter: cloudflare({ imageService: "passthrough" }),
  session: false,
  env: {
    schema: {
      // Pooled Neon connection string; the data layer reads it per request.
      DATABASE_URL: envField.string({ context: "server", access: "secret" }),
      // Managed Better Auth (Neon Auth) for the admin area.
      NEON_AUTH_BASE_URL: envField.string({
        context: "server",
        access: "secret",
      }),
      // Signs the cached session-data cookie (32+ characters).
      NEON_AUTH_COOKIE_SECRET: envField.string({
        context: "server",
        access: "secret",
      }),
      // Neon Object Storage (S3-compatible) for task submission photos. The
      // endpoint is per branch; the key needs storage:read + storage:write.
      AWS_ENDPOINT_URL_S3: envField.string({
        context: "server",
        access: "secret",
      }),
      AWS_ACCESS_KEY_ID: envField.string({
        context: "server",
        access: "secret",
      }),
      AWS_SECRET_ACCESS_KEY: envField.string({
        context: "server",
        access: "secret",
      }),
      AWS_REGION: envField.string({
        context: "server",
        access: "secret",
        default: "us-east-2",
      }),
      STORAGE_BUCKET: envField.string({
        context: "server",
        access: "secret",
        default: "uploads",
      }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
