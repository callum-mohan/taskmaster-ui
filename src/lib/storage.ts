import { AwsClient } from "aws4fetch";
import {
  AWS_ACCESS_KEY_ID,
  AWS_ENDPOINT_URL_S3,
  AWS_REGION,
  AWS_SECRET_ACCESS_KEY,
  STORAGE_BUCKET,
} from "astro:env/server";

// Neon Object Storage (S3-compatible) over `aws4fetch`: plain `fetch` with
// SigV4 signing, which suits Cloudflare Workers. The bucket is private; the
// site serves images through short-lived presigned URLs. Path-style URLs
// (`{endpoint}/{bucket}/{key}`), as Neon's custom endpoint requires.

let cached: AwsClient | undefined;

/** Lazily created so the secrets are read at request time, not module load. */
function client(): AwsClient {
  return (cached ??= new AwsClient({
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    region: AWS_REGION,
    service: "s3",
  }));
}

const objectUrl = (key: string) =>
  `${AWS_ENDPOINT_URL_S3.replace(/\/+$/, "")}/${STORAGE_BUCKET}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

export class StorageError extends Error {}

/** Uploads an object, replacing any object with the same key. */
export async function putObject(
  key: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<void> {
  const response = await client().fetch(objectUrl(key), {
    method: "PUT",
    body,
    headers: {
      "Content-Type": contentType,
      // Keys are unique per upload, so the bytes never change.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
  if (!response.ok) {
    throw new StorageError(`PutObject failed (${response.status})`);
  }
}

/** A time-limited GET link for a private object (no credentials needed). */
export async function presignGet(
  key: string,
  expiresInSeconds = 600,
): Promise<string> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  const signed = await client().sign(url.href, {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}

/**
 * Deletes objects, best effort: a failure is logged rather than thrown, so a
 * storage hiccup never undoes a database change that already happened.
 */
export async function deleteObjects(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        const response = await client().fetch(objectUrl(key), {
          method: "DELETE",
        });
        if (!response.ok && response.status !== 404) {
          console.error(`DeleteObject ${key} failed (${response.status})`);
        }
      } catch (error) {
        console.error(`DeleteObject ${key} failed`, error);
      }
    }),
  );
}
