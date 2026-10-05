import dalmatianCoastalKarstHero from "@/assets/track-themes/dalmatian-coastal-karst.webp";
import dalmatianCoastalKarstCard from "@/assets/track-themes/dalmatian-coastal-karst-card.webp";
import dinaraHighRidgeHero from "@/assets/track-themes/dinara-high-ridge.webp";
import dinaraHighRidgeCard from "@/assets/track-themes/dinara-high-ridge-card.webp";
import gorskiKotarForestHero from "@/assets/track-themes/gorski-kotar-forest.webp";
import gorskiKotarForestCard from "@/assets/track-themes/gorski-kotar-forest-card.webp";
import istriaKvarnerHillsHero from "@/assets/track-themes/istria-kvarner-hills.webp";
import istriaKvarnerHillsCard from "@/assets/track-themes/istria-kvarner-hills-card.webp";
import krkaRiverCanyonHero from "@/assets/track-themes/krka-river-canyon.webp";
import krkaRiverCanyonCard from "@/assets/track-themes/krka-river-canyon-card.webp";
import kvarnerIslandTrailHero from "@/assets/track-themes/kvarner-island-trail.webp";
import kvarnerIslandTrailCard from "@/assets/track-themes/kvarner-island-trail-card.webp";
import medvednicaAutumnForestHero from "@/assets/track-themes/medvednica-autumn-forest.webp";
import medvednicaAutumnForestCard from "@/assets/track-themes/medvednica-autumn-forest-card.webp";
import papukSlavonianUplandsHero from "@/assets/track-themes/papuk-slavonian-uplands.webp";
import papukSlavonianUplandsCard from "@/assets/track-themes/papuk-slavonian-uplands-card.webp";
import velebitCanyonHero from "@/assets/track-themes/velebit-canyon.webp";
import velebitCanyonCard from "@/assets/track-themes/velebit-canyon-card.webp";
import { staticAssetUrl } from "@/lib/static-asset";

export type TrackImageThemeId =
  | "dalmatian-coastal-karst"
  | "velebit-canyon"
  | "gorski-kotar-forest"
  | "dinara-high-ridge"
  | "kvarner-island-trail"
  | "krka-river-canyon"
  | "istria-kvarner-hills"
  | "medvednica-autumn-forest"
  | "papuk-slavonian-uplands";

export type TrackImageTheme = {
  id: TrackImageThemeId;
  name: string;
  region: string;
  terrain: string;
  perspective: string;
  heroImage: string;
  cardImage: string;
  matchTerms: readonly string[];
};

export const trackImageThemes: readonly TrackImageTheme[] = [
  {
    id: "dalmatian-coastal-karst",
    name: "Dalmatian coastal karst",
    region: "Biokovo · Mosor · Makarska",
    terrain: "Exposed limestone above the Adriatic",
    perspective: "High oblique landscape survey",
    heroImage: staticAssetUrl(dalmatianCoastalKarstHero),
    cardImage: staticAssetUrl(dalmatianCoastalKarstCard),
    matchTerms: [
      "biokovo",
      "makarska",
      "mosor",
      "omis",
      "split",
      "dalmatia",
      "dalmatian",
      "coastal karst",
    ],
  },
  {
    id: "velebit-canyon",
    name: "Velebit limestone canyon",
    region: "Velebit · Paklenica · Lika",
    terrain: "Technical stone and shaded canyon",
    perspective: "Low ground-level trail view",
    heroImage: staticAssetUrl(velebitCanyonHero),
    cardImage: staticAssetUrl(velebitCanyonCard),
    matchTerms: [
      "velebit",
      "paklenica",
      "starigrad",
      "lika",
      "zadar",
      "canyon",
      "gorge",
    ],
  },
  {
    id: "gorski-kotar-forest",
    name: "Gorski Kotar forest",
    region: "Gorski Kotar · Risnjak",
    terrain: "Wet beech and fir singletrack",
    perspective: "Compressed view through forest layers",
    heroImage: staticAssetUrl(gorskiKotarForestHero),
    cardImage: staticAssetUrl(gorskiKotarForestCard),
    matchTerms: [
      "gorski kotar",
      "risnjak",
      "delnice",
      "fuzine",
      "mrkopalj",
      "cabar",
      "forest",
      "woodland",
    ],
  },
  {
    id: "dinara-high-ridge",
    name: "Dinara high ridge",
    region: "Dinara · Knin · Zagora",
    terrain: "Open highland ridge and pale stone",
    perspective: "Distant high-country panorama",
    heroImage: staticAssetUrl(dinaraHighRidgeHero),
    cardImage: staticAssetUrl(dinaraHighRidgeCard),
    matchTerms: [
      "dinara",
      "knin",
      "sinj",
      "zagora",
      "high ridge",
      "summit",
      "exposed",
      "skyrace",
    ],
  },
  {
    id: "kvarner-island-trail",
    name: "Kvarner island trail",
    region: "Kvarner · Učka · Croatian islands",
    terrain: "Runnable coastal scrub and island views",
    perspective: "Wide lateral coastal overlook",
    heroImage: staticAssetUrl(kvarnerIslandTrailHero),
    cardImage: staticAssetUrl(kvarnerIslandTrailCard),
    matchTerms: [
      "kvarner",
      "rijeka",
      "opatija",
      "krk",
      "cres",
      "rab",
      "losinj",
      "island",
    ],
  },
  {
    id: "krka-river-canyon",
    name: "Krka river canyon",
    region: "Krka · Šibenik hinterland",
    terrain: "Green karst valley and river edge",
    perspective: "Elevated terrain overview",
    heroImage: staticAssetUrl(krkaRiverCanyonHero),
    cardImage: staticAssetUrl(krkaRiverCanyonCard),
    matchTerms: [
      "krka",
      "sibenik",
      "skradin",
      "drnis",
      "torak",
      "river",
      "waterfall",
      "lake",
      "valley",
    ],
  },
  {
    id: "istria-kvarner-hills",
    name: "Istria and Kvarner hills",
    region: "Istria · Učka foothills · Kvarner hinterland",
    terrain: "Dry-stone lanes, olive country, and rolling green karst",
    perspective: "Long-lens lateral landscape",
    heroImage: staticAssetUrl(istriaKvarnerHillsHero),
    cardImage: staticAssetUrl(istriaKvarnerHillsCard),
    matchTerms: [
      "istria",
      "istra",
      "buzet",
      "motovun",
      "pazin",
      "labin",
      "groznjan",
      "ucka",
      "olive",
      "vineyard",
      "dry stone",
    ],
  },
  {
    id: "medvednica-autumn-forest",
    name: "Medvednica autumn forest",
    region: "Medvednica · Zagreb",
    terrain: "Rolling beech singletrack and damp autumn leaves",
    perspective: "Side-on woodland layers",
    heroImage: staticAssetUrl(medvednicaAutumnForestHero),
    cardImage: staticAssetUrl(medvednicaAutumnForestCard),
    matchTerms: [
      "medvednica",
      "sljeme",
      "zagreb",
      "gracani",
      "gračani",
      "podsused",
      "autumn forest",
      "beech",
    ],
  },
  {
    id: "papuk-slavonian-uplands",
    name: "Papuk and Slavonian uplands",
    region: "Papuk · Krndija · Slavonia",
    terrain: "Forested ridge, spring meadows, and Pannonian horizons",
    perspective: "High panoramic terrain survey",
    heroImage: staticAssetUrl(papukSlavonianUplandsHero),
    cardImage: staticAssetUrl(papukSlavonianUplandsCard),
    matchTerms: [
      "papuk",
      "krndija",
      "slavonia",
      "slavonija",
      "pozega",
      "požega",
      "velika",
      "orahovica",
      "pannonian",
    ],
  },
] as const;

function normalizeThemeText(parts: readonly (string | null | undefined)[]) {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function stableThemeIndex(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % trackImageThemes.length;
}

export function getTrackImageTheme(...parts: Array<string | null | undefined>): TrackImageTheme {
  const normalized = normalizeThemeText(parts);
  let bestTheme: TrackImageTheme | null = null;
  let bestScore = 0;

  for (const theme of trackImageThemes) {
    const score = theme.matchTerms.reduce(
      (total, term) => total + (normalized.includes(term) ? Math.max(1, term.split(" ").length) : 0),
      0,
    );
    if (score > bestScore) {
      bestTheme = theme;
      bestScore = score;
    }
  }

  return bestTheme ?? trackImageThemes[stableThemeIndex(normalized || "croatia")]!;
}

export function getTrackThemeCard(...parts: Array<string | null | undefined>) {
  return getTrackImageTheme(...parts).cardImage;
}

export function getTrackThemeHero(...parts: Array<string | null | undefined>) {
  return getTrackImageTheme(...parts).heroImage;
}

export function getTrackThemeGallery(...parts: Array<string | null | undefined>) {
  const primary = getTrackImageTheme(...parts);
  const primaryIndex = trackImageThemes.findIndex((theme) => theme.id === primary.id);

  return trackImageThemes.map(
    (_, offset) => trackImageThemes[(primaryIndex + offset) % trackImageThemes.length]!,
  );
}
