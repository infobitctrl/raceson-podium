import { publicEnv } from "@/lib/public-env";

const recoverySourceOrigins = new Set([
  "https://whffzvkqwmzbkrybadkq.supabase.co",
  "https://gnnmnhhvujdvyohcidki.supabase.co",
]);

// The recovery copied this organization's track media with unchanged object
// paths. Its source URLs remain in the imported rows and gallery JSON.
const recoveredTrackMediaPath =
  "/storage/v1/object/public/track-media/86457d25-8a7d-47d9-b9b4-6c30c4a15228/";

export function resolveRecoveredPublicMediaUrl(
  value: string | null | undefined,
  publicStorageBaseUrl = publicEnv.supabasePublicUrl,
) {
  const imageUrl = value?.trim();
  if (!imageUrl) return null;

  try {
    const source = new URL(imageUrl);
    if (!recoverySourceOrigins.has(source.origin)
      || source.username || source.password
      || !source.pathname.startsWith(recoveredTrackMediaPath)) return imageUrl;

    const target = new URL(publicStorageBaseUrl);
    if (!["http:", "https:"].includes(target.protocol)
      || target.username || target.password
      || recoverySourceOrigins.has(target.origin)) return imageUrl;

    return `${target.origin}${target.pathname.replace(/\/$/, "")}${source.pathname}${source.search}${source.hash}`;
  } catch {
    // Local assets, external images, and an unconfigured environment retain
    // their existing behavior. Never rewrite private or signed Storage URLs.
    return imageUrl;
  }
}
