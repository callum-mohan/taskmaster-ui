// Client-side photo optimisation for the submission forms. Phone photos are
// decoded in the browser, scaled down and re-encoded as WebP (JPEG where the
// browser can't encode WebP) before upload, so entries upload and load far
// faster. Re-encoding also drops EXIF metadata such as GPS location. Anything
// that can't be optimised is uploaded untouched; the server still checks the
// bytes either way.

/** Longest edge, in pixels, of an optimised photo. */
export const MAX_PHOTO_EDGE = 2048;
/** Encoder quality (0–1) for WebP and the JPEG fallback. */
export const PHOTO_QUALITY = 0.82;

export interface Size {
  width: number;
  height: number;
}

interface FileLike {
  name: string;
  type: string;
  size: number;
}

const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

/** Scales a size down (never up) so its longest edge fits `maxEdge`. */
export function fitWithin(size: Size, maxEdge = MAX_PHOTO_EDGE): Size {
  const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

export const isHeic = (file: Pick<FileLike, "name" | "type">) =>
  /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

/** GIFs may be animated, so they're never re-encoded (it would freeze them). */
export const canOptimize = (file: Pick<FileLike, "name" | "type">) =>
  file.type !== "image/gif" && (file.type.startsWith("image/") || isHeic(file));

/**
 * Whether to upload the re-encoded photo: always for HEIC (the site can't
 * show it), otherwise only when it's actually smaller.
 */
export const preferOptimized = (original: FileLike, optimized: FileLike) =>
  isHeic(original) || optimized.size < original.size;

/** Swaps (or adds) a file name's extension: `IMG_1.JPG` → `IMG_1.webp`. */
export function withExtension(name: string, extension: string): string {
  const stem = name.replace(/\.[^./\\]*$/, "") || "photo";
  return `${stem}.${extension}`;
}

interface Decoded extends Size {
  image: CanvasImageSource;
  release: () => void;
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall back to <img>, which some browsers decode more formats with.
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    image: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

const encode = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, PHOTO_QUALITY),
  );

/**
 * Returns a smaller WebP/JPEG copy of the photo, or the original file when
 * it's a GIF, can't be decoded, or wouldn't get any smaller.
 */
export async function optimizePhoto(file: File): Promise<File> {
  if (!canOptimize(file)) return file;
  try {
    const source = await decode(file);
    const { width, height } = fitWithin(source);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      source.release();
      return file;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source.image, 0, 0, width, height);
    source.release();

    let blob = await encode(canvas, "image/webp");
    if (blob?.type !== "image/webp") {
      // Safari can't encode WebP. JPEG has no alpha, so flatten onto white.
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      blob = await encode(canvas, "image/jpeg");
    }
    const extension = blob && EXTENSIONS[blob.type];
    if (!blob || !extension) return file;
    const optimized = new File([blob], withExtension(file.name, extension), {
      type: blob.type,
      lastModified: file.lastModified,
    });
    return preferOptimized(file, optimized) ? optimized : file;
  } catch {
    return file;
  }
}

/** Puts `file` into a file input so the form uploads it. False if unsupported. */
export function setInputFile(input: HTMLInputElement, file: File): boolean {
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    const picked = input.files?.[0];
    return picked?.name === file.name && picked.size === file.size;
  } catch {
    return false;
  }
}

/** "4.2 MB" / "380 KB", for status messages. */
export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
