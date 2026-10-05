"use client";

import { cn } from "@/lib/utils";
import { brand } from "./brand";
import {
  brandNavbar,
  brandNavbarLight,
  brandNavbarSymbol,
  brandNavbarSymbolLight,
} from "./brandAssets";
import { useBrandThemeAsset } from "./useBrandThemeAsset";

type BrandNavbarLockupProps = {
  className?: string;
  decorative?: boolean;
  eager?: boolean;
  onLight?: boolean;
};

export function BrandNavbarLockup({
  className,
  decorative = false,
  eager = false,
  onLight = false,
}: BrandNavbarLockupProps) {
  const loading = eager ? "eager" : "lazy";
  const decoding = eager ? "sync" : "async";
  const symbolSrc = useBrandThemeAsset({
    darkSrc: brandNavbarSymbol,
    lightSrc: brandNavbarSymbolLight,
    onLight,
  });
  const wordmarkSrc = useBrandThemeAsset({
    darkSrc: brandNavbar,
    lightSrc: brandNavbarLight,
    onLight,
  });

  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : brand.name}
      aria-hidden={decorative || undefined}
      className={cn(
        "inline-flex w-auto shrink-0 items-center gap-2",
        className,
      )}
    >
      <span className="relative block aspect-[641/457] h-full shrink-0">
        {symbolSrc ? (
          <img
            src={symbolSrc}
            alt=""
            width={192}
            height={137}
            loading={loading}
            decoding={decoding}
            className="block h-full w-full object-contain"
            aria-hidden="true"
          />
        ) : null}
      </span>
      {wordmarkSrc ? (
        <img
          src={wordmarkSrc}
          alt=""
          width={384}
          height={73}
          loading={loading}
          decoding={decoding}
          className="block h-full w-auto max-w-none object-contain"
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}
