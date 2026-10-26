import { z } from "astro/zod";
import type {
  SubmissionKind,
  SubmissionOutcome,
  SubmissionOwnerRef,
} from "../types";

// Parsing for the player submission form (`/account/submissions/[taskId]`).
// Photos are checked by their bytes, not the browser's claimed type, and
// only formats every browser can display are accepted (never SVG, which can
// carry script).

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 5000;
export const MAX_CAPTION_LENGTH = 280;
/** Request bodies above this are refused before the form is parsed. */
export const MAX_SUBMISSION_REQUEST_BYTES = MAX_PHOTO_BYTES + 256 * 1024;
/** Most entries an admin can allow per player or squad. */
export const MAX_SUBMISSIONS_PER_TASK = 10;
/**
 * Sent by the upload script so the endpoint answers with JSON rather than a
 * redirect. A custom header also can't be sent cross-site without CORS.
 */
export const UPLOAD_PROGRESS_HEADER = "x-upload-progress";
/** For the file picker's `accept` attribute. */
export const PHOTO_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/avif";
export const SUBMISSION_KINDS: SubmissionKind[] = ["photo", "text"];

export interface ImageType {
  contentType: string;
  extension: string;
}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "mif1",
  "msf1",
]);

/**
 * Identifies an image from its leading bytes. Returns "heic" for iPhone
 * HEIC/HEIF photos (most browsers can't show them) and undefined for
 * anything else that isn't a supported image.
 */
export function sniffImage(bytes: Uint8Array): ImageType | "heic" | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") {
    return { contentType: "image/png", extension: "png" };
  }
  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") {
    return { contentType: "image/gif", extension: "gif" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { contentType: "image/webp", extension: "webp" };
  }
  if (ascii(bytes, 4, 4) === "ftyp") {
    // ISO-BMFF: the major brand, then compatible brands, fill the ftyp box.
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
    const end = Math.min(boxSize, bytes.length, 256);
    const brands = [ascii(bytes, 8, 4)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(bytes, i, 4));
    if (brands.some((b) => b === "avif" || b === "avis")) {
      return { contentType: "image/avif", extension: "avif" };
    }
    if (brands.some((b) => HEIF_BRANDS.has(b))) return "heic";
  }
  return undefined;
}

export type SubmissionIntent =
  "create-photo" | "create-text" | "edit" | "delete";

/**
 * An admin adding an entry for a player (the week's judge tab,
 * `/admin/weeks/[id]/judge`).
 */
export type AddEntryIntent = "add-photo" | "add-text";

export const isAddEntryIntent = (value: unknown): value is AddEntryIntent =>
  value === "add-photo" || value === "add-text";

export function parseSubmissionIntent(
  form: FormData,
): SubmissionIntent | undefined {
  const intent = form.get("intent");
  return intent === "create-photo" ||
    intent === "create-text" ||
    intent === "edit" ||
    intent === "delete"
    ? intent
    : undefined;
}

type Parsed<T> =
  { ok: true; data: T } | { ok: false; outcome: SubmissionOutcome };

const caption = z
  .string()
  .trim()
  .max(MAX_CAPTION_LENGTH)
  .transform((v) => (v === "" ? null : v.replace(/\r\n/g, "\n")));

const textEntry = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TEXT_LENGTH)
  .transform((v) => v.replace(/\r\n/g, "\n"));

export interface PhotoEntryInput {
  bytes: ArrayBuffer;
  type: ImageType;
  caption: string | null;
}

export async function parsePhotoEntry(
  form: FormData,
): Promise<Parsed<PhotoEntryInput>> {
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, outcome: "invalid" };
  }
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, outcome: "too-large" };
  const parsedCaption = caption.safeParse(String(form.get("caption") ?? ""));
  if (!parsedCaption.success) return { ok: false, outcome: "invalid" };
  const bytes = await file.arrayBuffer();
  const type = sniffImage(
    new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 256)),
  );
  if (type === "heic") return { ok: false, outcome: "heic" };
  if (!type) return { ok: false, outcome: "bad-type" };
  return { ok: true, data: { bytes, type, caption: parsedCaption.data } };
}

export function parseTextEntry(form: FormData): Parsed<string> {
  const parsed = textEntry.safeParse(String(form.get("text") ?? ""));
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, outcome: "invalid" };
}

/**
 * A player's edit to one of their entries: a text entry's body (required)
 * or a photo's caption (blank removes it). The photo itself can't change;
 * withdraw it and upload another instead.
 */
export function parseEntryEdit(
  form: FormData,
  kind: SubmissionKind,
): Parsed<string | null> {
  if (kind === "text") return parseTextEntry(form);
  const parsed = caption.safeParse(String(form.get("caption") ?? ""));
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, outcome: "invalid" };
}

/** A positive integer submission id from a hidden field. */
export function parseSubmissionId(
  form: FormData,
  name = "submissionId",
): number | undefined {
  const id = Number(form.get(name));
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/** Where an entry's photo lives in the bucket (unique per upload). */
export const submissionObjectKey = (
  taskId: string,
  owner: SubmissionOwnerRef,
  type: ImageType,
) =>
  `submissions/${taskId}/${owner.type}-${owner.id}/${crypto.randomUUID()}.${type.extension}`;
