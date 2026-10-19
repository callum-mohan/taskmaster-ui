import { describe, expect, it } from "vitest";
import {
  MAX_PHOTO_EDGE,
  canOptimize,
  fitWithin,
  formatBytes,
  isHeic,
  preferOptimized,
  withExtension,
} from "./photo-optimize";

const file = (name: string, type: string, size = 1000) => ({
  name,
  type,
  size,
});

describe("fitWithin", () => {
  it("scales the longest edge down to the limit, keeping the aspect ratio", () => {
    expect(fitWithin({ width: 4032, height: 3024 })).toEqual({
      width: MAX_PHOTO_EDGE,
      height: 1536,
    });
    expect(fitWithin({ width: 3024, height: 4032 })).toEqual({
      width: 1536,
      height: MAX_PHOTO_EDGE,
    });
  });

  it("never scales a small photo up", () => {
    expect(fitWithin({ width: 640, height: 480 })).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("keeps extreme panoramas at least a pixel tall", () => {
    expect(fitWithin({ width: 100_000, height: 10 }, 1000)).toEqual({
      width: 1000,
      height: 1,
    });
  });
});

describe("isHeic", () => {
  it.each([
    file("IMG_1.HEIC", ""),
    file("photo.heif", "application/octet-stream"),
    file("photo", "image/heic"),
    file("photo", "image/heif-sequence"),
  ])("detects %j", (f) => expect(isHeic(f)).toBe(true));

  it("ignores other photos", () => {
    expect(isHeic(file("photo.jpg", "image/jpeg"))).toBe(false);
  });
});

describe("canOptimize", () => {
  it.each(["image/jpeg", "image/png", "image/webp", "image/avif"])(
    "re-encodes %s",
    (type) => expect(canOptimize(file("photo", type))).toBe(true),
  );

  it("leaves GIFs alone so animations keep playing", () => {
    expect(canOptimize(file("party.gif", "image/gif"))).toBe(false);
  });

  it("tries HEIC even when the browser gives no type", () => {
    expect(canOptimize(file("IMG_1.HEIC", ""))).toBe(true);
  });

  it("skips files that aren't images", () => {
    expect(canOptimize(file("notes.txt", "text/plain"))).toBe(false);
  });
});

describe("preferOptimized", () => {
  it("uses the re-encoded photo only when it's smaller", () => {
    const original = file("a.jpg", "image/jpeg", 4_000_000);
    expect(
      preferOptimized(original, file("a.webp", "image/webp", 400_000)),
    ).toBe(true);
    expect(
      preferOptimized(original, file("a.webp", "image/webp", 4_000_001)),
    ).toBe(false);
  });

  it("always converts HEIC, which the site can't show", () => {
    expect(
      preferOptimized(
        file("a.heic", "image/heic", 1_000),
        file("a.jpg", "image/jpeg", 2_000),
      ),
    ).toBe(true);
  });
});

describe("withExtension", () => {
  it.each([
    ["IMG_0001.JPG", "IMG_0001.webp"],
    ["holiday.photo.png", "holiday.photo.webp"],
    ["no-extension", "no-extension.webp"],
    [".jpg", "photo.webp"],
  ])("renames %s", (name, expected) =>
    expect(withExtension(name, "webp")).toBe(expected),
  );
});

describe("formatBytes", () => {
  it("shows MB above a megabyte and KB below", () => {
    expect(formatBytes(4.2 * 1024 * 1024)).toBe("4.2 MB");
    expect(formatBytes(380 * 1024)).toBe("380 KB");
    expect(formatBytes(10)).toBe("1 KB");
  });
});
