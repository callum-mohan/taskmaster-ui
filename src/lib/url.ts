/**
 * Prefix an app-absolute path with the site's configured `base` so links work
 * both at the domain root during local dev and under a sub-path such as
 * `/taskmaster-ui/` on GitHub Pages. Pass root-relative paths (e.g. `/tasks`).
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (path === "/") return `${base}/`;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

/** The inverse of `withBase`: a request path relative to the site's `base`. */
export function withoutBase(pathname: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (!base || !pathname.startsWith(base)) return pathname;
  return pathname.slice(base.length) || "/";
}

/**
 * An image source that may be an absolute https URL (left as is) or a site
 * path (given the `base`), e.g. a shop item's `imageUrl`.
 */
export function assetUrl(src: string): string {
  return /^https:\/\//i.test(src) ? src : withBase(src);
}
