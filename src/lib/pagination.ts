import type { Page, PageInfo, PageLinkSlot } from "../types";

/** Rows per page for tables and lists. */
export const LIST_PAGE_SIZE = 10;
/** Entries per page in media galleries (fills the 2- and 3-column grids). */
export const GALLERY_PAGE_SIZE = 12;

/** A 1-based page number from a query param or form field; anything else is page 1. */
export function parsePage(value: string | null | undefined): number {
  if (!value || !/^\d{1,6}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

/** Where `requested` falls in a list of `total` items, clamped to the last page. */
export function pageInfo(
  total: number,
  requested: number,
  pageSize: number,
): PageInfo {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.floor(requested) || 1), pageCount);
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return { page, pageCount, pageSize: size, total, from, to };
}

/** The slice of `items` on the requested page. */
export function paginate<T>(
  items: readonly T[],
  requested: number,
  pageSize: number,
): Page<T> {
  const info = pageInfo(items.length, requested, pageSize);
  return {
    ...info,
    items: items.slice(Math.max(0, info.from - 1), info.to),
  };
}

/**
 * Page numbers to link to: always the first and last, the current page with
 * `siblings` either side, and a gap wherever pages are skipped. A gap that
 * would hide a single page shows that page instead.
 */
export function pageSlots(
  page: number,
  pageCount: number,
  siblings = 1,
): PageLinkSlot[] {
  const shown = new Set<number>([1, pageCount]);
  for (let n = page - siblings; n <= page + siblings; n++) {
    if (n >= 1 && n <= pageCount) shown.add(n);
  }
  const sorted = [...shown].sort((a, b) => a - b);
  const slots: PageLinkSlot[] = [];
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && n - prev === 2) slots.push(prev + 1);
    else if (prev !== undefined && n - prev > 2) slots.push("gap");
    slots.push(n);
  });
  return slots;
}

export interface PageHrefOptions {
  /** Fragment to jump to, without the `#` (e.g. the list's section id). */
  hash?: string;
  /** One-off params to leave behind, e.g. a form outcome. */
  drop?: readonly string[];
}

/**
 * A link to `page` of the list driven by `param`, keeping every other query
 * param (so paging one list doesn't reset another). Page 1 drops the param.
 */
export function pageHref(
  url: URL,
  param: string,
  page: number,
  { hash, drop = [] }: PageHrefOptions = {},
): string {
  const params = new URLSearchParams(url.search);
  for (const key of drop) params.delete(key);
  if (page > 1) params.set(param, String(page));
  else params.delete(param);
  const search = params.toString();
  return `${url.pathname}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}
