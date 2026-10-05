// Explicit aliases keep existing editions and saved links stable. Never derive an
// existing edition's identity by stripping its year: multiple editions can coexist.
const eventAliases: Record<string, string> = {
  "s-ubicevac-trail-2026": "subicevac-trail",
};

export function canonicalEventSlug(slug: string) {
  return Object.hasOwn(eventAliases, slug) ? eventAliases[slug] : slug;
}

export function storedEventSlug(slug: string) {
  return Object.entries(eventAliases).find(([, canonical]) => canonical === slug)?.[0] ?? slug;
}

export function canonicalEventPathname(pathname: string) {
  return pathname.replace(
    /^(\/(?:organizer\/|en\/|hr\/)?events\/)([^/]+)(\/?)$/,
    (_, prefix: string, slug: string, suffix: string) => `${prefix}${canonicalEventSlug(slug)}${suffix}`,
  );
}
