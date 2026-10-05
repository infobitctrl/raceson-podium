export function isNextOptimizablePublicImageUrl(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return true;

  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.endsWith(".supabase.co")
      && url.pathname.startsWith("/storage/v1/object/public/");
  } catch {
    return false;
  }
}
