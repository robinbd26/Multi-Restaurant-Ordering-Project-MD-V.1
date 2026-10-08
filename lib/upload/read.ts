import "server-only";

import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { notFound } from "@/lib/http/errors";
import { contentTypeFor, resolveUploadPath } from "@/lib/upload/paths";
import { uploadVariantKey } from "@/lib/upload/variants";

/**
 * The bytes of a stored upload, preferring the `width` variant when asked and
 * falling back to the primary (rows written before variants existed, or a
 * variant that failed to encode). Callers do their own access check first.
 */
export async function readStoredImage(key: string, width?: number | null) {
  const candidates = [width ? uploadVariantKey(key, width) : null, key].filter((k): k is string => Boolean(k));
  for (const candidate of candidates) {
    const abs = resolveUploadPath(candidate);
    if (!abs) continue;
    try {
      return { data: await readFile(abs), contentType: contentTypeFor(abs) };
    } catch {
      // Missing variant: try the next candidate.
    }
  }
  throw notFound();
}

/** An image response with the given cache policy. */
export function imageResponse(image: { data: Buffer; contentType: string }, cacheControl: string): Response {
  return new NextResponse(new Uint8Array(image.data), {
    status: 200,
    headers: { "Content-Type": image.contentType, "Cache-Control": cacheControl },
  });
}
