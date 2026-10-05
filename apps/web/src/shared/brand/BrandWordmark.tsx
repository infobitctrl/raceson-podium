"use client";

import { cn } from "@/lib/utils";
import { brand } from "./brand";
import {
  brandNavbar,
  brandNavbarLight,
  brandWordmark,
  brandWordmarkLight,
} from "./brandAssets";
import { useBrandThemeAsset } from "./useBrandThemeAsset";

type BrandWordmarkProps = {
  className?: string;
  onLight?: boolean;
  eager?: boolean;
  src?: string;
};

export function BrandWordmark({
  className,
  onLight = false,
  eager = false,
  src = brandWordmark,
}: BrandWordmarkProps) {
  const isNavbarWordmark = src === brandNavbar;
  const lightSrc = isNavbarWordmark ? brandNavbarLight : brandWordmarkLight;
  const aspectRatio = isNavbarWordmark ? "1786 / 340" : "1600 / 400";
  const selectedSrc = useBrandThemeAsset({ darkSrc: src, lightSrc, onLight });
  const intrinsicSize = isNavbarWordmark
    ? { width: 384, height: 73 }
    : { width: 960, height: 240 };

  return (
    <span
      role="img"
      aria-label={brand.name}
      className={cn(
        "relative inline-block shrink-0",
        className,
      )}
      style={{ aspectRatio }}
    >
      {selectedSrc ? (
        <img
          src={selectedSrc}
          alt=""
          width={intrinsicSize.width}
          height={intrinsicSize.height}
          loading={eager ? "eager" : "lazy"}
          decoding={eager ? "sync" : "async"}
          className="absolute inset-0 h-full w-full object-contain"
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}
