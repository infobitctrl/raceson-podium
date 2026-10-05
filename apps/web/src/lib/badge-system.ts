import type { LucideIcon } from "lucide-react";
import {
  Award,
  Calendar,
  CloudLightning,
  CloudSun,
  Compass,
  Crown,
  Flag,
  Handshake,
  Heart,
  Link2,
  MapPin,
  Medal,
  Moon,
  Mountain,
  RotateCcw,
  Shield,
  Star,
  Target,
  Trophy,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import {
  BADGE_DEFINITIONS,
  type BadgeDefinitionSeed,
} from "@/lib/badge-catalog.generated";

export type BadgeState = "permanent" | "dynamic" | "seasonal" | "legacy" | "manual";
export type BadgeType = "athlete" | "track" | "team" | "league" | "special";
export type BadgeMetricType =
  | "count"
  | "rank"
  | "campaign"
  | "distance_km"
  | "elevation_m"
  | "pace_sec_per_km"
  | "percent"
  | "boolean";

export type BadgeValueTierCode = "M1" | "M2" | "M3" | "M4" | "M5";
export type BadgeHardnessCode = "H1" | "H2" | "H3" | "H4" | "H5";
export type BadgePrestigeCode = "P1" | "P2" | "P3" | "P4" | "PL";
export type LegacyBadgeTier = "gold" | "silver" | "bronze" | "default";
export type BadgeUiStatus = "earned" | "locked" | "in-progress";
export type BadgeStampVariant =
  | "count"
  | "rank"
  | "campaign"
  | "distance"
  | "climb"
  | "pace"
  | "percent"
  | "boolean";

export interface BadgeValueTierToken {
  code: BadgeValueTierCode;
  name: string;
  materialLabel: string;
  defaultPrestige: BadgePrestigeCode;
  shellClassName: string;
  rimClassName: string;
  iconClassName: string;
  glowClassName: string;
  stampClassName: string;
}

export interface BadgeHardnessToken {
  code: BadgeHardnessCode;
  name: string;
  clipPath: string;
}

export interface BadgePrestigeToken {
  code: BadgePrestigeCode;
  name: string;
  ringClassName: string;
  haloClassName: string;
  labelClassName: string;
}

export interface BadgeIconToken {
  key: string;
  label: string;
  Icon: LucideIcon;
}

export interface BadgeVisualSpec {
  badgeType: BadgeType;
  state: BadgeState;
  iconKey: string;
  tierCode: BadgeValueTierCode;
  hardnessCode: BadgeHardnessCode;
  prestigeCode: BadgePrestigeCode;
  metricLabel?: string;
  metricType?: BadgeMetricType;
  familyCode?: string;
  provisionalHardness?: boolean;
}

type LegacyBadgeCompatibility = Omit<
  BadgeVisualSpec,
  "hardnessCode" | "provisionalHardness"
> & {
  hardnessCode?: BadgeHardnessCode;
};

export type LegacyBadgeInput = {
  id?: string;
  name: string;
  iconKey: string;
  tier: LegacyBadgeTier;
};

export const BADGE_VALUE_TIERS: Record<BadgeValueTierCode, BadgeValueTierToken> = {
  M1: {
    code: "M1",
    name: "Wood",
    materialLabel: "Carved wood medallion",
    defaultPrestige: "P1",
    shellClassName:
      "bg-[radial-gradient(circle_at_28%_24%,rgba(255,242,214,0.9),rgba(167,116,72,0.92)_42%,rgba(103,64,34,0.98)_100%)]",
    rimClassName: "border-[rgba(88,56,34,0.72)] bg-[rgba(70,42,23,0.18)]",
    iconClassName: "text-[hsl(25_25%_22%)]",
    glowClassName: "bg-[radial-gradient(circle,rgba(126,79,44,0.28),transparent_72%)]",
    stampClassName: "bg-[rgba(245,228,199,0.94)] text-[hsl(25_30%_22%)] border-[rgba(86,56,34,0.28)]",
  },
  M2: {
    code: "M2",
    name: "Bronze",
    materialLabel: "Bronze body with extra notch",
    defaultPrestige: "P1",
    shellClassName:
      "bg-[radial-gradient(circle_at_28%_24%,rgba(255,235,217,0.96),rgba(191,119,72,0.95)_38%,rgba(120,67,38,0.98)_100%)]",
    rimClassName: "border-[rgba(111,63,38,0.7)] bg-[rgba(255,214,183,0.14)]",
    iconClassName: "text-[hsl(21_42%_22%)]",
    glowClassName: "bg-[radial-gradient(circle,rgba(191,119,72,0.28),transparent_72%)]",
    stampClassName: "bg-[rgba(255,236,225,0.96)] text-[hsl(20_38%_24%)] border-[rgba(120,67,38,0.28)]",
  },
  M3: {
    code: "M3",
    name: "Silver",
    materialLabel: "Silver body with richer frame detail",
    defaultPrestige: "P2",
    shellClassName:
      "bg-[radial-gradient(circle_at_28%_24%,rgba(255,255,255,0.98),rgba(207,214,224,0.98)_42%,rgba(120,132,148,0.98)_100%)]",
    rimClassName: "border-[rgba(115,126,142,0.58)] bg-[rgba(255,255,255,0.2)]",
    iconClassName: "text-[hsl(220_18%_28%)]",
    glowClassName: "bg-[radial-gradient(circle,rgba(170,184,202,0.3),transparent_72%)]",
    stampClassName: "bg-[rgba(255,255,255,0.95)] text-[hsl(220_18%_28%)] border-[rgba(120,132,148,0.28)]",
  },
  M4: {
    code: "M4",
    name: "Gold",
    materialLabel: "Gold body with deeper embossing",
    defaultPrestige: "P3",
    shellClassName:
      "bg-[radial-gradient(circle_at_28%_24%,rgba(255,250,214,0.98),rgba(247,197,58,0.98)_40%,rgba(173,112,18,0.98)_100%)]",
    rimClassName: "border-[rgba(156,104,16,0.7)] bg-[rgba(255,240,178,0.18)]",
    iconClassName: "text-[hsl(30_44%_20%)]",
    glowClassName: "bg-[radial-gradient(circle,rgba(247,197,58,0.34),transparent_72%)]",
    stampClassName: "bg-[rgba(255,252,230,0.96)] text-[hsl(33_52%_22%)] border-[rgba(173,112,18,0.28)]",
  },
  M5: {
    code: "M5",
    name: "Obsidian",
    materialLabel: "Obsidian-black core with the richest frame",
    defaultPrestige: "P4",
    shellClassName:
      "bg-[radial-gradient(circle_at_28%_24%,rgba(135,145,170,0.82),rgba(35,39,51,0.98)_40%,rgba(8,10,16,1)_100%)]",
    rimClassName: "border-[rgba(138,151,182,0.36)] bg-[rgba(255,255,255,0.08)]",
    iconClassName: "text-[hsl(40_28%_92%)]",
    glowClassName: "bg-[radial-gradient(circle,rgba(122,137,167,0.32),transparent_72%)]",
    stampClassName: "bg-[rgba(28,34,48,0.96)] text-[hsl(40_20%_90%)] border-[rgba(138,151,182,0.24)]",
  },
};

export const BADGE_HARDNESS: Record<BadgeHardnessCode, BadgeHardnessToken> = {
  H1: { code: "H1", name: "Trailhead", clipPath: "circle(50% at 50% 50%)" },
  H2: {
    code: "H2",
    name: "Trail",
    clipPath: "polygon(24% 6%,76% 6%,96% 50%,76% 94%,24% 94%,4% 50%)",
  },
  H3: {
    code: "H3",
    name: "Mountain",
    clipPath: "polygon(12% 26%,34% 8%,52% 24%,70% 8%,88% 26%,88% 82%,12% 82%)",
  },
  H4: {
    code: "H4",
    name: "Extreme",
    clipPath: "polygon(10% 28%,28% 8%,40% 24%,56% 6%,72% 22%,90% 12%,90% 82%,10% 82%)",
  },
  H5: {
    code: "H5",
    name: "Epic",
    clipPath:
      "polygon(50% 0%,65% 19%,89% 11%,81% 37%,100% 50%,81% 63%,89% 89%,65% 81%,50% 100%,35% 81%,11% 89%,19% 63%,0% 50%,19% 37%,11% 11%,35% 19%)",
  },
};

export const BADGE_PRESTIGE: Record<BadgePrestigeCode, BadgePrestigeToken> = {
  P1: {
    code: "P1",
    name: "Core",
    ringClassName: "border-[rgba(255,255,255,0.24)] bg-[rgba(255,255,255,0.08)]",
    haloClassName: "bg-[radial-gradient(circle,rgba(255,255,255,0.12),transparent_70%)]",
    labelClassName: "bg-muted/70 text-muted-foreground border-border/70",
  },
  P2: {
    code: "P2",
    name: "Notable",
    ringClassName: "border-[rgba(255,255,255,0.36)] bg-[rgba(255,255,255,0.12)]",
    haloClassName: "bg-[radial-gradient(circle,rgba(255,255,255,0.18),transparent_72%)]",
    labelClassName: "bg-secondary/85 text-foreground border-border",
  },
  P3: {
    code: "P3",
    name: "Elite",
    ringClassName: "border-[rgba(255,226,140,0.54)] bg-[rgba(255,231,154,0.16)]",
    haloClassName: "bg-[radial-gradient(circle,rgba(255,221,108,0.22),transparent_72%)]",
    labelClassName: "bg-[rgba(255,242,200,0.92)] text-[hsl(30_40%_22%)] border-[rgba(184,132,33,0.28)]",
  },
  P4: {
    code: "P4",
    name: "Legendary",
    ringClassName: "border-[rgba(255,231,155,0.74)] bg-[rgba(255,224,120,0.2)]",
    haloClassName: "bg-[radial-gradient(circle,rgba(255,210,92,0.3),transparent_74%)]",
    labelClassName: "bg-[rgba(255,240,198,0.95)] text-[hsl(28_56%_20%)] border-[rgba(204,142,32,0.34)]",
  },
  PL: {
    code: "PL",
    name: "Legacy",
    ringClassName: "border-[rgba(232,213,145,0.72)] bg-[rgba(216,179,82,0.2)]",
    haloClassName: "bg-[radial-gradient(circle,rgba(228,187,82,0.28),transparent_74%)]",
    labelClassName: "bg-[rgba(43,33,18,0.92)] text-[hsl(45_52%_82%)] border-[rgba(232,213,145,0.28)]",
  },
};

export const BADGE_ICONS: Record<string, BadgeIconToken> = {
  award: { key: "award", label: "Award", Icon: Award },
  "official-results": { key: "official-results", label: "Official results", Icon: Award },
  distance: { key: "distance", label: "Distance", Icon: Flag },
  elevation: { key: "elevation", label: "Elevation", Icon: Mountain },
  podium: { key: "podium", label: "Podium", Icon: Medal },
  wins: { key: "wins", label: "Wins", Icon: Crown },
  "category-win": { key: "category-win", label: "Category win", Icon: Award },
  streak: { key: "streak", label: "Streak", Icon: Calendar },
  night: { key: "night", label: "Night", Icon: Moon },
  speed: { key: "speed", label: "Speed", Icon: Zap },
  "single-effort-distance": { key: "single-effort-distance", label: "Single effort distance", Icon: Flag },
  "route-variety": { key: "route-variety", label: "Route variety", Icon: Compass },
  seasons: { key: "seasons", label: "Seasons", Icon: Calendar },
  "track-finish": { key: "track-finish", label: "Route finish", Icon: MapPin },
  "track-pb": { key: "track-pb", label: "Route PB", Icon: Target },
  "track-leaderboard": { key: "track-leaderboard", label: "Route leaderboard", Icon: TrendingUp },
  "track-season-rank": { key: "track-season-rank", label: "Route season rank", Icon: Flag },
  "track-conditions": { key: "track-conditions", label: "Route conditions", Icon: CloudSun },
  "team-appearances": { key: "team-appearances", label: "Team appearances", Icon: Users },
  "team-scoring": { key: "team-scoring", label: "Team scoring", Icon: Shield },
  "team-anchor": { key: "team-anchor", label: "Team anchor", Icon: Shield },
  "team-clutch": { key: "team-clutch", label: "Team clutch", Icon: Shield },
  "team-podium": { key: "team-podium", label: "Team podium", Icon: Medal },
  "team-wins": { key: "team-wins", label: "Team wins", Icon: Trophy },
  "team-campaign": { key: "team-campaign", label: "Team campaign", Icon: Link2 },
  "team-season-rank": { key: "team-season-rank", label: "Team season rank", Icon: Flag },
  "team-titles": { key: "team-titles", label: "Team titles", Icon: Trophy },
  "league-participation": { key: "league-participation", label: "League participation", Icon: Link2 },
  "league-live-rank": { key: "league-live-rank", label: "Live league rank", Icon: TrendingUp },
  "league-final-rank": { key: "league-final-rank", label: "Final league rank", Icon: Trophy },
  "league-led-rounds": { key: "league-led-rounds", label: "Rounds led", Icon: Crown },
  "league-momentum": { key: "league-momentum", label: "League momentum", Icon: TrendingUp },
  "league-round-wins": { key: "league-round-wins", label: "League round wins", Icon: Trophy },
  "league-seasons": { key: "league-seasons", label: "League seasons", Icon: Calendar },
  founder: { key: "founder", label: "Founder", Icon: Star },
  "fair-play": { key: "fair-play", label: "Fair play", Icon: Handshake },
  "organizer-choice": { key: "organizer-choice", label: "Organizer choice", Icon: Star },
  volunteer: { key: "volunteer", label: "Volunteer", Icon: Heart },
  "storm-runner": { key: "storm-runner", label: "Storm runner", Icon: CloudLightning },
  comeback: { key: "comeback", label: "Comeback", Icon: RotateCcw },
  mountain: { key: "mountain", label: "Mountain", Icon: Mountain },
  trophy: { key: "trophy", label: "Trophy", Icon: Trophy },
  moon: { key: "moon", label: "Moon", Icon: Moon },
  flame: { key: "flame", label: "Flame", Icon: Zap },
  shield: { key: "shield", label: "Shield", Icon: Shield },
  star: { key: "star", label: "Star", Icon: Star },
  target: { key: "target", label: "Target", Icon: Target },
  zap: { key: "zap", label: "Zap", Icon: Zap },
};

const LEGACY_TIER_TO_LAYER: Record<
  LegacyBadgeTier,
  Pick<BadgeVisualSpec, "tierCode" | "hardnessCode" | "prestigeCode">
> = {
  default: { tierCode: "M1", hardnessCode: "H2", prestigeCode: "P1" },
  bronze: { tierCode: "M2", hardnessCode: "H2", prestigeCode: "P1" },
  silver: { tierCode: "M3", hardnessCode: "H3", prestigeCode: "P2" },
  gold: { tierCode: "M4", hardnessCode: "H4", prestigeCode: "P3" },
};

const PROVISIONAL_HARDNESS_BY_TIER: Record<BadgeValueTierCode, BadgeHardnessCode> = {
  M1: "H2",
  M2: "H2",
  M3: "H3",
  M4: "H4",
  M5: "H5",
};

const BADGE_DEFINITION_BY_SLUG = new Map(
  BADGE_DEFINITIONS.map((definition) => [normalizeBadgeKey(definition.slug), definition]),
);

const LEGACY_BADGE_COMPATIBILITY: Record<string, LegacyBadgeCompatibility> = {
  "ultra-finisher": {
    badgeType: "athlete",
    state: "permanent",
    iconKey: "single-effort-distance",
    tierCode: "M3",
    prestigeCode: "P3",
    metricLabel: "50K",
    metricType: "distance_km",
    familyCode: "A10",
  },
  "season-leader": {
    badgeType: "league",
    state: "dynamic",
    iconKey: "league-live-rank",
    tierCode: "M4",
    prestigeCode: "P3",
    hardnessCode: "H3",
    metricLabel: "T3",
    metricType: "rank",
    familyCode: "L02",
  },
  "night-runner": {
    badgeType: "athlete",
    state: "permanent",
    iconKey: "night",
    tierCode: "M1",
    prestigeCode: "P1",
    metricLabel: "1",
    metricType: "count",
    familyCode: "A08",
  },
  "podium-regular": {
    badgeType: "athlete",
    state: "permanent",
    iconKey: "podium",
    tierCode: "M2",
    prestigeCode: "P2",
    metricLabel: "3",
    metricType: "count",
    familyCode: "A04",
  },
  "iron-legs": {
    badgeType: "athlete",
    state: "permanent",
    iconKey: "distance",
    tierCode: "M4",
    prestigeCode: "P3",
    metricLabel: "500K",
    metricType: "distance_km",
    familyCode: "A02",
  },
  "speed-demon": {
    badgeType: "athlete",
    state: "permanent",
    iconKey: "speed",
    tierCode: "M2",
    prestigeCode: "P2",
    hardnessCode: "H2",
    metricLabel: "5:00",
    metricType: "pace_sec_per_km",
    familyCode: "A09",
  },
  "race-veteran": {
    badgeType: "athlete",
    state: "permanent",
    iconKey: "official-results",
    tierCode: "M3",
    prestigeCode: "P2",
    metricLabel: "25",
    metricType: "count",
    familyCode: "A01",
  },
  "mountain-goat": {
    badgeType: "athlete",
    state: "permanent",
    iconKey: "elevation",
    tierCode: "M4",
    prestigeCode: "P3",
    metricLabel: "25K↑",
    metricType: "elevation_m",
    familyCode: "A03",
  },
  "streak-master": {
    badgeType: "athlete",
    state: "permanent",
    iconKey: "streak",
    tierCode: "M3",
    prestigeCode: "P2",
    metricLabel: "6",
    metricType: "count",
    familyCode: "A07",
  },
  legend: {
    badgeType: "athlete",
    state: "permanent",
    iconKey: "wins",
    tierCode: "M4",
    prestigeCode: "P4",
    metricLabel: "10",
    metricType: "count",
    familyCode: "A05",
  },
};

export function getDefaultPrestigeForTier(
  tierCode: BadgeValueTierCode,
): BadgePrestigeCode {
  return BADGE_VALUE_TIERS[tierCode].defaultPrestige;
}

export function getBadgeValueTierToken(
  tierCode: BadgeValueTierCode,
): BadgeValueTierToken {
  return BADGE_VALUE_TIERS[tierCode];
}

export function getBadgeHardnessToken(
  hardnessCode: BadgeHardnessCode,
): BadgeHardnessToken {
  return BADGE_HARDNESS[hardnessCode];
}

export function getBadgePrestigeToken(
  prestigeCode: BadgePrestigeCode,
): BadgePrestigeToken {
  return BADGE_PRESTIGE[prestigeCode];
}

export function getBadgeIconToken(iconKey: string): BadgeIconToken {
  return BADGE_ICONS[iconKey] ?? BADGE_ICONS.award;
}

export function getBadgeStampVariant(
  metricType?: BadgeMetricType,
): BadgeStampVariant | "none" {
  switch (metricType) {
    case "count":
      return "count";
    case "rank":
      return "rank";
    case "campaign":
      return "campaign";
    case "distance_km":
      return "distance";
    case "elevation_m":
      return "climb";
    case "pace_sec_per_km":
      return "pace";
    case "percent":
      return "percent";
    case "boolean":
      return "boolean";
    default:
      return "none";
  }
}

export function getBadgeMetaLabels(spec: BadgeVisualSpec): string[] {
  const labels = [
    getBadgeValueTierToken(spec.tierCode).name,
    getBadgeHardnessToken(spec.hardnessCode).name,
    getBadgePrestigeToken(spec.prestigeCode).name,
  ];

  if (spec.metricLabel) {
    labels.push(spec.metricLabel);
  }

  return labels;
}

function normalizeBadgeKey(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildBadgeVisualSpecFromDefinition(
  definition: BadgeDefinitionSeed,
): BadgeVisualSpec {
  return {
    badgeType: definition.badgeType,
    state: definition.state,
    iconKey: definition.iconKey,
    tierCode: definition.tierCode,
    hardnessCode:
      definition.fixedHardnessCode ?? PROVISIONAL_HARDNESS_BY_TIER[definition.tierCode],
    prestigeCode: definition.prestigeCode,
    metricLabel: definition.metricLabel,
    metricType: definition.metricType as BadgeMetricType,
    familyCode: definition.familyCode,
    provisionalHardness: !definition.fixedHardnessCode,
  };
}

export function getCatalogBadgeDefinition(
  slug: string,
): BadgeDefinitionSeed | null {
  return BADGE_DEFINITION_BY_SLUG.get(normalizeBadgeKey(slug)) ?? null;
}

export function getCatalogBadgeVisualSpec(
  slug: string,
): BadgeVisualSpec | null {
  const definition = getCatalogBadgeDefinition(slug);
  return definition ? buildBadgeVisualSpecFromDefinition(definition) : null;
}

export function getLegacyBadgeVisualSpec(
  badge: LegacyBadgeInput,
): BadgeVisualSpec {
  const lookupKey = normalizeBadgeKey(badge.id || badge.name);
  const definition = BADGE_DEFINITION_BY_SLUG.get(lookupKey);
  const compatibility = LEGACY_BADGE_COMPATIBILITY[lookupKey];
  const tierFallback = LEGACY_TIER_TO_LAYER[badge.tier];

  if (definition) {
    return buildBadgeVisualSpecFromDefinition(definition);
  }

  return {
    badgeType: compatibility?.badgeType ?? "athlete",
    state: compatibility?.state ?? "permanent",
    iconKey: compatibility?.iconKey ?? badge.iconKey,
    tierCode: compatibility?.tierCode ?? tierFallback.tierCode,
    hardnessCode: compatibility?.hardnessCode ?? tierFallback.hardnessCode,
    prestigeCode:
      compatibility?.prestigeCode ??
      getDefaultPrestigeForTier(compatibility?.tierCode ?? tierFallback.tierCode),
    metricLabel: compatibility?.metricLabel,
    metricType: compatibility?.metricType,
    familyCode: compatibility?.familyCode,
    provisionalHardness: !compatibility?.hardnessCode,
  };
}
