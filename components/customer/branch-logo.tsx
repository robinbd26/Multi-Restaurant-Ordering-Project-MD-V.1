"use client";

import { useState } from "react";

import { cn, mediaUrl } from "@/lib/utils";

/**
 * A branch's logo on the customer Restaurants cards, with a clean fallback.
 *
 * Same approach as UserAvatar: a plain <img> with onError, not next/image.
 * next/image THROWS on an absolute URL whose host is not in
 * images.remotePatterns, so one odd value typed into a branch's logo field
 * could take down the whole page; a missing or expired upload showed the
 * broken-image glyph. Here any failure, or no value at all, shows the shop
 * emoji the card already used for "no logo".
 */
export function BranchLogo({ logo, name, className }: { logo: string | null | undefined; name: string; className?: string }) {
  const src = mediaUrl(logo);
  // Keyed by src, so a changed logo gets a fresh attempt without an effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return (
      <span className="text-4xl" aria-hidden="true" data-testid="branch-logo-fallback">
        🏪
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      width={64}
      height={64}
      loading="lazy"
      className={cn("size-16 rounded-2xl object-cover", className)}
      onError={() => setFailedSrc(src)}
    />
  );
}
