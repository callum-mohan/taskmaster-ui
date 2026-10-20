/**
 * Pins `sslmode=verify-full` on a Postgres URL. node-postgres 8 already
 * treats Neon's `sslmode=require` as `verify-full` (and warns about it);
 * pg 9 will switch `require` to weaker libpq semantics, so be explicit to
 * keep full certificate verification after upgrading.
 */
export function withVerifiedSsl(connectionString: string): string {
  const url = new URL(connectionString);
  const mode = url.searchParams.get("sslmode");
  if (mode === "prefer" || mode === "require" || mode === "verify-ca") {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}
