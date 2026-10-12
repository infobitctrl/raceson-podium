import {artworkVariants} from './artworkVariants';

/** Matches the shared event/campaign grid; callers can describe smaller rows. */
export const artworkCardSizes = '(max-width: 600px) calc(100vw - 32px), (max-width: 1000px) calc((100vw - 72px) / 2), 352px';
const bySource = new Map(artworkVariants.flatMap(variants => variants.map(image => [image.src, variants] as const)));

export function artworkImageProps(src:string, sizes=artworkCardSizes) {
  const variants = bySource.get(src);
  if (!variants) return {src};
  const fallback = variants[1];
  return {src:fallback.src, width:fallback.width, height:fallback.height, sizes,
    srcSet:variants.map(image => `${image.src} ${image.width}w`).join(', ')};
}

/** Detail headers cover the full content width; keep their original CSS crop. */
export function artworkHero(src:string) {
  const variants = bySource.get(src);
  return variants ? variants[variants.length - 1].src : src;
}
