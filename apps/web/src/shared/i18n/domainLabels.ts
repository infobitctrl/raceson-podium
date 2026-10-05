export function localizedCountryName(
  countryCode: string | null | undefined,
  localeTag: string,
  fallback = "Croatia",
) {
  const normalized = countryCode?.trim().toUpperCase() || "HR";
  try {
    return new Intl.DisplayNames([localeTag], { type: "region" }).of(normalized) || fallback;
  } catch {
    return fallback;
  }
}

export function localizedClassificationLabel(value: string, locale: "en" | "hr") {
  if (locale !== "hr") return value;
  const normalized = value.trim().replace(/\s+/g, " ");
  const labels: Record<string, string> = {
    Overall: "Ukupno",
    Short: "Kratka",
    Long: "Duga",
    Female: "Žene",
    Male: "Muškarci",
    Open: "Otvoreno",
    "Female Open": "Žene – otvoreno",
    "Male Open": "Muškarci – otvoreno",
    "Female U16": "Djevojke U16",
    "Male U16": "Dječaci U16",
    "Senior 65+": "Seniori 65+",
  };
  return labels[normalized] ?? normalized;
}

export function localizedRegionLabel(value: string, locale: "en" | "hr") {
  if (locale !== "hr") return value;
  const labels: Record<string, string> = {
    All: "Sve",
    Croatia: "Hrvatska",
    Slovenia: "Slovenija",
    Bosnia: "Bosna i Hercegovina",
    Montenegro: "Crna Gora",
    Serbia: "Srbija",
    "North Macedonia": "Sjeverna Makedonija",
  };
  return labels[value] ?? value;
}

export function localizedRegionLocationLabel(city: string, region: string, locale: "en" | "hr") {
  const localizedRegion = localizedRegionLabel(region, locale).trim();
  const parts = [city.trim(), localizedRegion].filter(Boolean);
  return parts.filter((part, index) => (
    parts.findIndex((candidate) => candidate.localeCompare(part, locale, { sensitivity: "base" }) === 0) === index
  )).join(", ");
}

export function localizedLocationLabel(value: string, locale: "en" | "hr") {
  if (locale !== "hr") return value;
  return localizedRegionLabel(value, locale)
    .replace(/,\s*Croatia\b/g, ", Hrvatska")
    .replace(/,\s*Slovenia\b/g, ", Slovenija")
    .replace(/,\s*Montenegro\b/g, ", Crna Gora")
    .replace(/,\s*Serbia\b/g, ", Srbija")
    .replace(/,\s*Bosnia(?: and Herzegovina)?\b/g, ", Bosna i Hercegovina");
}

export function localizedDistanceBandLabel(value: string, locale: "en" | "hr") {
  if (locale !== "hr") return value;
  const labels: Record<string, string> = {
    All: "Sve",
    "Short · 5–10 km": "Kratka · 5–10 km",
    "Medium · 10–20 km": "Srednja · 10–20 km",
    "Long · 20–30 km": "Duga · 20–30 km",
    "Extra long · 30–40 km": "Vrlo duga · 30–40 km",
    "Marathon · 40–50 km": "Maraton · 40–50 km",
    "Ultra marathon · 50+ km": "Ultramaraton · 50+ km",
    "Below 5 km · unclassified": "Ispod 5 km · bez kategorije",
  };
  return labels[value] ?? value;
}

export function localizedTrackTagLabel(id: string, fallback: string, locale: "en" | "hr") {
  if (locale !== "hr") return fallback;
  const labels: Record<string, string> = {
    race: "Utrka",
    ultra: "Ultra",
    skyrace: "SkyRace",
    vertical: "Vertikal",
    "fun-run": "Rekreativna utrka",
    training: "Trening",
    mountain: "Planina",
    forest: "Šuma",
    karst: "Krš",
    ridge: "Greben",
    snow: "Snijeg",
    coastal: "Obala",
    road: "Cesta",
    family: "Obiteljski",
    night: "Noćna",
    short: "Kratka",
    mid: "Srednja",
    long: "Duga",
    "fkt-eligible": "FKT",
    "dog-friendly": "Prikladno za pse",
    "strava-segment": "Segment",
  };
  return labels[id] ?? fallback;
}

export function localizedBadgeTaxonomyLabel(value: string, locale: "en" | "hr") {
  if (locale !== "hr") return value;
  const labels: Record<string, string> = {
    Wood: "Drvo",
    Bronze: "Bronca",
    Silver: "Srebro",
    Gold: "Zlato",
    Obsidian: "Opsidijan",
    Trailhead: "Početak rute",
    Trail: "Ruta",
    Mountain: "Planina",
    Extreme: "Ekstremno",
    Epic: "Epski",
    Core: "Osnovno",
    Notable: "Istaknuto",
    Elite: "Elitno",
    Legendary: "Legendarno",
    Legacy: "Nasljeđe",
    permanent: "Trajno",
    dynamic: "Promjenjivo",
    seasonal: "Sezonski",
    legacy: "Nasljeđe",
    manual: "Ručno",
  };
  return labels[value] ?? value;
}
