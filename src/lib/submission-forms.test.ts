import { describe, expect, it } from "vitest";
import {
  isAddEntryIntent,
  MAX_CAPTION_LENGTH,
  MAX_PHOTO_BYTES,
  MAX_SUBMISSION_REQUEST_BYTES,
  MAX_TEXT_LENGTH,
  parseEntryEdit,
  parsePhotoEntry,
  parseSubmissionId,
  parseSubmissionIntent,
  parseTextEntry,
  PHOTO_ACCEPT,
  sniffImage,
  submissionObjectKey,
} from "./submission-forms";

function formData(fields: Record<string, string | File> = {}): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

/** Bytes from a mix of numbers and ASCII strings. */
function bytes(...parts: (number | string)[]): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "number") out.push(part);
    else for (const ch of part) out.push(ch.charCodeAt(0));
  }
  return new Uint8Array(out);
}

/** An ISO-BMFF `ftyp` box: size, "ftyp", major brand, version, compatible brands. */
const ftyp = (major: string, ...compatible: string[]) =>
  bytes(
    0,
    0,
    0,
    16 + 4 * compatible.length,
    "ftyp",
    major,
    0,
    0,
    0,
    0,
    ...compatible,
  );

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, "JFIF", 0);
const PNG = bytes(0x89, "PNG\r\n", 0x1a, "\n", 0, 0, 0, 0x0d, "IHDR");
const GIF87 = bytes("GIF87a", 1, 0, 1, 0);
const GIF89 = bytes("GIF89a", 1, 0, 1, 0);
const WEBP = bytes("RIFF", 0x24, 0, 0, 0, "WEBPVP8 ");
const AVIF = ftyp("avif", "mif1", "miaf");
const HEIC = ftyp("heic", "mif1", "heic");

const file = (data: Uint8Array<ArrayBuffer>, name = "photo", type = "") =>
  new File([data], name, { type });

describe("sniffImage", () => {
  it.each([
    ["JPEG", JPEG, "image/jpeg", "jpg"],
    ["PNG", PNG, "image/png", "png"],
    ["GIF87a", GIF87, "image/gif", "gif"],
    ["GIF89a", GIF89, "image/gif", "gif"],
    ["WebP", WEBP, "image/webp", "webp"],
    ["AVIF", AVIF, "image/avif", "avif"],
    ["AVIF sequence", ftyp("avis", "msf1"), "image/avif", "avif"],
  ])("identifies %s", (_, data, contentType, extension) => {
    expect(sniffImage(data)).toEqual({ contentType, extension });
  });

  it("identifies AVIF from a compatible brand", () => {
    expect(sniffImage(ftyp("mif1", "miaf", "avif"))).toEqual({
      contentType: "image/avif",
      extension: "avif",
    });
  });

  it.each(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"])(
    "flags the HEIF brand %s",
    (brand) => {
      expect(sniffImage(ftyp(brand))).toBe("heic");
    },
  );

  it("flags HEIC from a compatible brand", () => {
    expect(sniffImage(ftyp("isom", "heic"))).toBe("heic");
    expect(sniffImage(HEIC)).toBe("heic");
  });

  it("only reads brands inside the ftyp box", () => {
    const shortBox = bytes(0, 0, 0, 16, "ftyp", "isom", 0, 0, 0, 0, "avif");
    expect(sniffImage(shortBox)).toBeUndefined();
  });

  it("reads an array that starts partway into its buffer", () => {
    const padded = new Uint8Array(4 + AVIF.length);
    padded.set(AVIF, 4);
    expect(sniffImage(padded.subarray(4))).toEqual({
      contentType: "image/avif",
      extension: "avif",
    });
  });

  it.each([
    ["an empty file", new Uint8Array()],
    ["an MP4 video", ftyp("isom", "mp41")],
    ["an SVG", bytes('<svg xmlns="http://www.w3.org/2000/svg">')],
    ["a PDF", bytes("%PDF-1.7")],
    ["a truncated JPEG", bytes(0xff, 0xd8)],
    ["a RIFF that isn't WebP", bytes("RIFF", 0, 0, 0, 0, "WAVE")],
    ["a GIF with an unknown version", bytes("GIF90a")],
  ])("rejects %s", (_, data) => {
    expect(sniffImage(data)).toBeUndefined();
  });
});

describe("parsePhotoEntry", () => {
  it("parses a photo with a caption", async () => {
    const result = await parsePhotoEntry(
      formData({ photo: file(PNG), caption: "  Up, up\r\nand away  " }),
    );
    expect(result).toEqual({
      ok: true,
      data: {
        bytes: PNG.buffer,
        type: { contentType: "image/png", extension: "png" },
        caption: "Up, up\nand away",
      },
    });
  });

  it("treats a blank or missing caption as none", async () => {
    const cases: Record<string, string | File>[] = [
      { photo: file(JPEG) },
      { photo: file(JPEG), caption: "   " },
    ];
    for (const fields of cases) {
      const result = await parsePhotoEntry(formData(fields));
      expect(result.ok && result.data.caption).toBeNull();
    }
  });

  it("trusts the bytes over the claimed type", async () => {
    const result = await parsePhotoEntry(
      formData({ photo: file(GIF89, "photo.png", "image/png") }),
    );
    expect(result.ok && result.data.type).toEqual({
      contentType: "image/gif",
      extension: "gif",
    });

    const svg = file(bytes("<svg/>"), "photo.png", "image/png");
    expect(await parsePhotoEntry(formData({ photo: svg }))).toEqual({
      ok: false,
      outcome: "bad-type",
    });
  });

  it("refuses HEIC photos", async () => {
    expect(await parsePhotoEntry(formData({ photo: file(HEIC) }))).toEqual({
      ok: false,
      outcome: "heic",
    });
  });

  it("needs a non-empty file", async () => {
    const cases: Record<string, string | File>[] = [
      {},
      { photo: "not a file" },
      { photo: file(new Uint8Array()) },
    ];
    for (const fields of cases) {
      expect(await parsePhotoEntry(formData(fields))).toEqual({
        ok: false,
        outcome: "invalid",
      });
    }
  });

  it("accepts a photo at the size limit", async () => {
    const data = new Uint8Array(MAX_PHOTO_BYTES);
    data.set(JPEG);
    const result = await parsePhotoEntry(formData({ photo: file(data) }));
    expect(result.ok).toBe(true);
  });

  it("refuses a photo over the size limit", async () => {
    const data = new Uint8Array(MAX_PHOTO_BYTES + 1);
    data.set(JPEG);
    expect(await parsePhotoEntry(formData({ photo: file(data) }))).toEqual({
      ok: false,
      outcome: "too-large",
    });
  });

  it("limits the caption", async () => {
    const atLimit = await parsePhotoEntry(
      formData({ photo: file(PNG), caption: "c".repeat(MAX_CAPTION_LENGTH) }),
    );
    expect(atLimit.ok && atLimit.data.caption).toHaveLength(MAX_CAPTION_LENGTH);

    const over = await parsePhotoEntry(
      formData({
        photo: file(bytes("nope")),
        caption: "c".repeat(MAX_CAPTION_LENGTH + 1),
      }),
    );
    expect(over).toEqual({ ok: false, outcome: "invalid" });
  });
});

describe("parseTextEntry", () => {
  it("trims the text and normalises line endings", () => {
    expect(parseTextEntry(formData({ text: "  One\r\nTwo  " }))).toEqual({
      ok: true,
      data: "One\nTwo",
    });
  });

  it.each([
    ["missing", undefined],
    ["blank", "  \n "],
    ["too long", "t".repeat(MAX_TEXT_LENGTH + 1)],
  ])("rejects %s text", (_, text) => {
    const form = text === undefined ? formData() : formData({ text });
    expect(parseTextEntry(form)).toEqual({ ok: false, outcome: "invalid" });
  });

  it("accepts text at the limit", () => {
    const text = "t".repeat(MAX_TEXT_LENGTH);
    expect(parseTextEntry(formData({ text }))).toEqual({
      ok: true,
      data: text,
    });
  });
});

describe("parseSubmissionIntent", () => {
  it.each(["create-photo", "create-text", "edit", "delete"])(
    "accepts %s",
    (intent) => {
      expect(parseSubmissionIntent(formData({ intent }))).toBe(intent);
    },
  );

  it.each(["add-photo", "DELETE", ""])("rejects %j", (intent) => {
    expect(parseSubmissionIntent(formData({ intent }))).toBeUndefined();
  });

  it("is undefined without an intent", () => {
    expect(parseSubmissionIntent(formData())).toBeUndefined();
  });
});

describe("isAddEntryIntent", () => {
  it("accepts the admin intents only", () => {
    expect(isAddEntryIntent("add-photo")).toBe(true);
    expect(isAddEntryIntent("add-text")).toBe(true);
    expect(isAddEntryIntent("create-photo")).toBe(false);
    expect(isAddEntryIntent(null)).toBe(false);
  });
});

describe("parseSubmissionId", () => {
  it("reads a positive whole number", () => {
    expect(parseSubmissionId(formData({ submissionId: "12" }))).toBe(12);
    expect(parseSubmissionId(formData({ entry: "3" }), "entry")).toBe(3);
  });

  it.each(["", "0", "-4", "2.5", "abc"])("rejects %j", (submissionId) => {
    expect(parseSubmissionId(formData({ submissionId }))).toBeUndefined();
  });

  it("is undefined when the field is missing", () => {
    expect(parseSubmissionId(formData())).toBeUndefined();
  });
});

describe("submissionObjectKey", () => {
  const jpeg = { contentType: "image/jpeg", extension: "jpg" };

  it("files photos by task and owner", () => {
    expect(
      submissionObjectKey("week-01", { type: "player", id: "ada" }, jpeg),
    ).toMatch(
      /^submissions\/week-01\/player-ada\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
    );
    expect(
      submissionObjectKey(
        "week-02",
        { type: "team", id: "team-a" },
        { contentType: "image/webp", extension: "webp" },
      ),
    ).toMatch(/^submissions\/week-02\/team-team-a\/[0-9a-f-]{36}\.webp$/);
  });

  it("is unique per upload", () => {
    const owner = { type: "player", id: "ada" } as const;
    expect(submissionObjectKey("week-01", owner, jpeg)).not.toBe(
      submissionObjectKey("week-01", owner, jpeg),
    );
  });
});

describe("limits", () => {
  it("leaves room for the form around the largest photo", () => {
    expect(MAX_SUBMISSION_REQUEST_BYTES).toBeGreaterThan(MAX_PHOTO_BYTES);
  });

  it("only offers types the sniffer accepts", () => {
    const sniffed = [JPEG, PNG, GIF89, WEBP, AVIF].map(
      (data) => (sniffImage(data) as { contentType: string }).contentType,
    );
    expect(PHOTO_ACCEPT.split(",").sort()).toEqual(sniffed.sort());
  });
});

describe("parseEntryEdit", () => {
  it("requires a text entry's body", () => {
    expect(
      parseEntryEdit(formData({ text: "  new\r\nbody " }), "text"),
    ).toEqual({ ok: true, data: "new\nbody" });
    expect(parseEntryEdit(formData({ text: "   " }), "text")).toEqual({
      ok: false,
      outcome: "invalid",
    });
  });

  it("lets a photo's caption be changed or cleared", () => {
    expect(parseEntryEdit(formData({ caption: " hi " }), "photo")).toEqual({
      ok: true,
      data: "hi",
    });
    expect(parseEntryEdit(formData({ caption: "" }), "photo")).toEqual({
      ok: true,
      data: null,
    });
    expect(
      parseEntryEdit(
        formData({ caption: "x".repeat(MAX_CAPTION_LENGTH + 1) }),
        "photo",
      ),
    ).toEqual({ ok: false, outcome: "invalid" });
  });
});
