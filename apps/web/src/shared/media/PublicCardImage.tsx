import Image from "next/image";
import { cn } from "@/lib/utils";
import { isNextOptimizablePublicImageUrl } from "@/shared/media/optimizedPublicImage";
import { resolveRecoveredPublicMediaUrl } from "@/shared/media/recoveredPublicMedia";

export function PublicCardImage({
  src,
  alt,
  sizes,
  className,
  loading = "lazy",
  fetchPriority,
  quality = 75,
}: {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  quality?: 60 | 75;
}) {
  const imageSrc = resolveRecoveredPublicMediaUrl(src) ?? src;
  if (isNextOptimizablePublicImageUrl(imageSrc)) {
    return (
      <Image
        src={imageSrc}
        alt={alt}
        fill
        sizes={sizes}
        quality={quality}
        loading={loading}
        fetchPriority={fetchPriority}
        className={className}
      />
    );
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      decoding="async"
      loading={loading}
      fetchPriority={fetchPriority}
      className={cn("absolute inset-0 h-full w-full", className)}
    />
  );
}
