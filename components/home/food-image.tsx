"use client";

import Image from "next/image";
import { useState } from "react";

/** Food photo with an emoji fallback if the image is missing/broken. */
export function FoodImage({
  src,
  alt,
  fallback = "🍕",
  sizes,
  className,
}: {
  /** A product with no photo yet gives "" / null — that is the fallback case, not an error. */
  src: string | null | undefined;
  alt: string;
  fallback?: string;
  sizes?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  // An empty src must never reach next/image. While images were `unoptimized`
  // it degraded quietly into onError; with the optimizer enabled it is a hard
  // "missing required src property" error and the browser re-downloads the
  // page. Fall straight through to the emoji this component already renders.
  if (failed || !src) {
    return (
      <div className={`flex h-full w-full items-center justify-center bg-white/5 text-4xl ${className ?? ""}`}>
        {fallback}
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes ?? "(max-width: 640px) 50vw, 240px"}
      className={`object-cover ${className ?? ""}`}
      onError={() => setFailed(true)}
    />
  );
}
