type StaticAssetModule = {
  default?: unknown;
  src?: unknown;
};

/**
 * Bundler output may expose imported images as URL strings or StaticImageData
 * objects. Keep the client app's string-based image contracts stable here.
 */
export function staticAssetUrl(asset: unknown): string {
  if (typeof asset === "string" && asset.length > 0) return asset;
  if (asset && typeof asset === "object") {
    const module = asset as StaticAssetModule;
    if (typeof module.src === "string" && module.src.length > 0) {
      return module.src;
    }
    if (module.default !== undefined && module.default !== asset) {
      return staticAssetUrl(module.default);
    }
  }
  throw new TypeError("Static asset import did not resolve to a URL.");
}
