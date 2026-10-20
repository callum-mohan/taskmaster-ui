import { describe, expect, it } from "vitest";
import {
  pageHref,
  pageInfo,
  pageSlots,
  paginate,
  parsePage,
} from "./pagination";

describe("parsePage", () => {
  it.each([
    ["3", 3],
    ["1", 1],
    ["0", 1],
    ["-2", 1],
    ["2.5", 1],
    ["abc", 1],
    ["", 1],
    [null, 1],
    [undefined, 1],
    ["9999999", 1],
  ])("reads %j as page %i", (value, page) => {
    expect(parsePage(value)).toBe(page);
  });
});

describe("pageInfo", () => {
  it("describes a middle page", () => {
    expect(pageInfo(25, 2, 10)).toEqual({
      page: 2,
      pageCount: 3,
      pageSize: 10,
      total: 25,
      from: 11,
      to: 20,
    });
  });

  it("clamps past the end to the last page", () => {
    expect(pageInfo(25, 9, 10)).toMatchObject({ page: 3, from: 21, to: 25 });
  });

  it("treats an empty list as one empty page", () => {
    expect(pageInfo(0, 4, 10)).toEqual({
      page: 1,
      pageCount: 1,
      pageSize: 10,
      total: 0,
      from: 0,
      to: 0,
    });
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 23 }, (_, i) => i + 1);

  it("returns the requested slice", () => {
    expect(paginate(items, 3, 10).items).toEqual([21, 22, 23]);
  });

  it("returns everything on one page when it fits", () => {
    const page = paginate(items, 1, 50);
    expect(page.items).toEqual(items);
    expect(page.pageCount).toBe(1);
  });

  it("returns no items for an empty list", () => {
    expect(paginate([], 1, 10).items).toEqual([]);
  });
});

describe("pageSlots", () => {
  it("lists every page when there are only a few", () => {
    expect(pageSlots(1, 1)).toEqual([1]);
    expect(pageSlots(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it("collapses long runs into gaps around the current page", () => {
    expect(pageSlots(6, 12)).toEqual([1, "gap", 5, 6, 7, "gap", 12]);
    expect(pageSlots(1, 12)).toEqual([1, 2, "gap", 12]);
    expect(pageSlots(12, 12)).toEqual([1, "gap", 11, 12]);
  });

  it("shows a lone skipped page instead of a gap", () => {
    expect(pageSlots(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("pageHref", () => {
  const url = new URL("https://example.test/tasks/week-01?bonuses=2&entry=x");

  it("sets the page and keeps other lists' params", () => {
    expect(pageHref(url, "entries", 3, { hash: "entries" })).toBe(
      "/tasks/week-01?bonuses=2&entry=x&entries=3#entries",
    );
  });

  it("drops the param for page 1", () => {
    expect(pageHref(url, "bonuses", 1)).toBe("/tasks/week-01?entry=x");
  });

  it("drops one-off params", () => {
    expect(pageHref(url, "bonuses", 1, { drop: ["entry"] })).toBe(
      "/tasks/week-01",
    );
  });
});
