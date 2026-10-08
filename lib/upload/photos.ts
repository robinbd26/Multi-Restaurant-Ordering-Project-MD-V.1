import { CHAT_PHOTO_MAX_MB } from "@/lib/order-chat/policy";

/**
 * Customer photo attachments (order chat, product reviews, complaints) share
 * ONE pipeline: the browser checks type and size before sending (the same
 * `imageFileProblem` rule the server runs), and the server's `saveUpload()`
 * re-encodes to WebP, strips metadata, downscales to the folder's profile
 * (lib/upload/variants.ts) and writes a 320px thumbnail next to it.
 *
 * Client-safe on purpose (no fs, no sharp) so forms can import the limits.
 */

/** Per-photo input cap, the same as order chat's. */
export const PHOTO_MAX_MB = CHAT_PHOTO_MAX_MB;
export const PHOTO_MAX_BYTES = PHOTO_MAX_MB * 1024 * 1024;

/** Width of the thumbnail variant every photo folder writes. */
export const PHOTO_THUMB_WIDTH = 320;

export const REVIEW_PHOTO_SUBDIR = "review_photos";
export const REVIEW_PHOTO_MAX = 3;

export const COMPLAINT_PHOTO_SUBDIR = "complaint_photos";
export const COMPLAINT_PHOTO_MAX = 5;

/** A stored JSON array of storage keys → the keys ("" / junk → none). */
export function parsePhotoKeys(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string" && k.length > 0) : [];
  } catch {
    return [];
  }
}
