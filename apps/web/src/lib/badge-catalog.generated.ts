export type BadgeState = 'permanent' | 'dynamic' | 'seasonal' | 'legacy' | 'manual';
export type BadgeType = 'athlete' | 'track' | 'team' | 'league' | 'special';
export type BadgeMetricType =
  | 'count'
  | 'rank'
  | 'campaign'
  | 'distance_km'
  | 'elevation_m'
  | 'pace_sec_per_km'
  | 'percent'
  | 'boolean';

export type BadgeValueTierCode = 'M1' | 'M2' | 'M3' | 'M4' | 'M5';
export type BadgeHardnessCode = 'H1' | 'H2' | 'H3' | 'H4' | 'H5';
export type BadgePrestigeCode = 'P1' | 'P2' | 'P3' | 'P4' | 'PL';

export type BadgeRuleType =
  | 'count_threshold'
  | 'sum_threshold'
  | 'best_value_threshold'
  | 'rank_range'
  | 'consecutive_periods'
  | 'route_count_threshold'
  | 'route_best_threshold'
  | 'season_progress_threshold'
  | 'season_rounds_led_threshold'
  | 'position_gain_threshold'
  | 'event_flag_match'
  | 'manual_admin_award';

export type HardnessStrategy = 'weighted' | 'direct' | 'fixed' | 'manual';

export interface BadgeValueTierToken {
  code: BadgeValueTierCode;
  name: string;
  order: number;
  material: string;
  cssClass: string;
  frameDetail: string;
  defaultPrestige: BadgePrestigeCode;
}

export interface BadgeHardnessToken {
  code: BadgeHardnessCode;
  name: string;
  order: number;
  shapeKey: string;
  silhouette: string;
  description: string;
}

export interface BadgePrestigeToken {
  code: BadgePrestigeCode;
  name: string;
  order: number;
  accentKey: string;
  accentStyle: string;
}

export interface BadgeIconToken {
  key: string;
  family: string;
  label: string;
}

export interface BadgeFamilyDefinition {
  code: string;
  type: BadgeType;
  slug: string;
  familyName: string;
  state: BadgeState;
  iconKey: string;
  metricType: BadgeMetricType;
  hardnessStrategy: HardnessStrategy;
  description: string;
}

export interface BadgeDefinitionSeed {
  familyCode: string;
  badgeType: BadgeType;
  slug: string;
  name: string;
  state: BadgeState;
  tierCode: BadgeValueTierCode;
  prestigeCode: BadgePrestigeCode;
  metricType: BadgeMetricType;
  metricValue: number | string | boolean;
  metricLabel: string;
  iconKey: string;
  ruleType: BadgeRuleType;
  hardnessStrategy: HardnessStrategy;
  fixedHardnessCode?: BadgeHardnessCode;
  description: string;
  ruleConfig: Record<string, unknown>;
}

export const BADGE_VALUE_TIERS: BadgeValueTierToken[] = [
  {
    code: 'M1',
    name: 'Wood',
    order: 1,
    material: 'wood',
    cssClass: 'badge-tier-wood',
    frameDetail: 'simple-carved-ring',
    defaultPrestige: 'P1',
  },
  {
    code: 'M2',
    name: 'Bronze',
    order: 2,
    material: 'bronze',
    cssClass: 'badge-tier-bronze',
    frameDetail: 'single-notch-ring',
    defaultPrestige: 'P1',
  },
  {
    code: 'M3',
    name: 'Silver',
    order: 3,
    material: 'silver',
    cssClass: 'badge-tier-silver',
    frameDetail: 'double-notch-ring',
    defaultPrestige: 'P2',
  },
  {
    code: 'M4',
    name: 'Gold',
    order: 4,
    material: 'gold',
    cssClass: 'badge-tier-gold',
    frameDetail: 'deep-embossed-ring',
    defaultPrestige: 'P3',
  },
  {
    code: 'M5',
    name: 'Obsidian',
    order: 5,
    material: 'obsidian',
    cssClass: 'badge-tier-obsidian',
    frameDetail: 'legendary-chiseled-ring',
    defaultPrestige: 'P4',
  },
];

export const BADGE_HARDNESS: BadgeHardnessToken[] = [
  {
    code: 'H1',
    name: 'Trailhead',
    order: 1,
    shapeKey: 'round-medallion',
    silhouette: 'soft circle with clean edge',
    description: 'Entry effort or low-complexity challenge.',
  },
  {
    code: 'H2',
    name: 'Trail',
    order: 2,
    shapeKey: 'hex-shield',
    silhouette: 'firm six-sided shield',
    description: 'Standard race effort or moderate challenge.',
  },
  {
    code: 'H3',
    name: 'Mountain',
    order: 3,
    shapeKey: 'peak-crest',
    silhouette: 'mountain-cut crest',
    description: 'Hard route, strong competition, or demanding effort.',
  },
  {
    code: 'H4',
    name: 'Extreme',
    order: 4,
    shapeKey: 'jagged-summit',
    silhouette: 'rugged summit silhouette',
    description: 'Very hard challenge, final season placements, or severe conditions.',
  },
  {
    code: 'H5',
    name: 'Epic',
    order: 5,
    shapeKey: 'relic-star-crest',
    silhouette: 'multi-layer heroic relic crest',
    description: 'Rare heroic accomplishment, sweep, or historic achievement.',
  },
];

export const BADGE_PRESTIGE: BadgePrestigeToken[] = [
  {
    code: 'P1',
    name: 'Core',
    order: 1,
    accentKey: 'plain-ring',
    accentStyle: 'simple outer ring',
  },
  {
    code: 'P2',
    name: 'Notable',
    order: 2,
    accentKey: 'etched-ring',
    accentStyle: 'etched ring with side tabs',
  },
  {
    code: 'P3',
    name: 'Elite',
    order: 3,
    accentKey: 'laurel-ring',
    accentStyle: 'laurel or bright trim ring',
  },
  {
    code: 'P4',
    name: 'Legendary',
    order: 4,
    accentKey: 'crown-halo',
    accentStyle: 'crown halo or radiant border',
  },
  {
    code: 'PL',
    name: 'Legacy',
    order: 5,
    accentKey: 'dated-seal',
    accentStyle: 'dated edition seal with special ribbon',
  },
];

export const BADGE_ICONS: BadgeIconToken[] = [
  { key: 'official-results', family: 'athlete', label: 'Bib + footprint' },
  { key: 'distance', family: 'athlete', label: 'Shoe + trail line' },
  { key: 'elevation', family: 'athlete', label: 'Mountain peak' },
  { key: 'podium', family: 'athlete', label: 'Laurel podium' },
  { key: 'wins', family: 'athlete', label: 'Crown' },
  { key: 'category-win', family: 'athlete', label: 'Rosette' },
  { key: 'streak', family: 'athlete', label: 'Chain + calendar' },
  { key: 'night', family: 'athlete', label: 'Moon' },
  { key: 'speed', family: 'athlete', label: 'Lightning shoe' },
  { key: 'single-effort-distance', family: 'athlete', label: 'Summit flag' },
  { key: 'route-variety', family: 'athlete', label: 'Compass' },
  { key: 'seasons', family: 'athlete', label: 'Season ring + calendar' },
  { key: 'track-finish', family: 'track', label: 'Route line + pin' },
  { key: 'track-pb', family: 'track', label: 'Stopwatch + down arrow' },
  { key: 'track-leaderboard', family: 'track', label: 'Leaderboard peaks' },
  { key: 'track-season-rank', family: 'track', label: 'Flag on route' },
  { key: 'track-conditions', family: 'track', label: 'Sun + moon + cloud' },
  { key: 'team-appearances', family: 'team', label: 'Shield + runners' },
  { key: 'team-scoring', family: 'team', label: 'Shield + 3 stars' },
  { key: 'team-anchor', family: 'team', label: 'Captain shield' },
  { key: 'team-clutch', family: 'team', label: 'Shield + final star' },
  { key: 'team-podium', family: 'team', label: 'Laurel shield' },
  { key: 'team-wins', family: 'team', label: 'Crown shield' },
  { key: 'team-campaign', family: 'team', label: 'Linked crest + 6-ring' },
  { key: 'team-season-rank', family: 'team', label: 'Team flag podium' },
  { key: 'team-titles', family: 'team', label: 'Champion ring' },
  { key: 'league-participation', family: 'league', label: '6-node ring' },
  { key: 'league-live-rank', family: 'league', label: 'Standing ladder' },
  { key: 'league-final-rank', family: 'league', label: 'Trophy hex' },
  { key: 'league-led-rounds', family: 'league', label: 'Jersey crown' },
  { key: 'league-momentum', family: 'league', label: 'Upward arrow hex' },
  { key: 'league-round-wins', family: 'league', label: 'Burst trophy' },
  { key: 'league-seasons', family: 'league', label: 'Season crest' },
  { key: 'founder', family: 'special', label: 'Founder seal' },
  { key: 'fair-play', family: 'special', label: 'Handshake laurel' },
  { key: 'organizer-choice', family: 'special', label: 'Star seal' },
  { key: 'volunteer', family: 'special', label: 'Heart pin' },
  { key: 'storm-runner', family: 'special', label: 'Weather bolt' },
  { key: 'comeback', family: 'special', label: 'Return arrow' },
];

export const BADGE_FAMILIES: BadgeFamilyDefinition[] = [
  {
    code: 'A01',
    type: 'athlete',
    slug: 'official-results-count',
    familyName: 'Official Results Count',
    state: 'permanent',
    iconKey: 'official-results',
    metricType: 'count',
    hardnessStrategy: 'weighted',
    description: 'How many official race results the athlete has accumulated.',
  },
  {
    code: 'A02',
    type: 'athlete',
    slug: 'total-distance',
    familyName: 'Total Distance',
    state: 'permanent',
    iconKey: 'distance',
    metricType: 'distance_km',
    hardnessStrategy: 'weighted',
    description: 'Total race and training distance on the platform.',
  },
  {
    code: 'A03',
    type: 'athlete',
    slug: 'total-elevation-gain',
    familyName: 'Total Elevation Gain',
    state: 'permanent',
    iconKey: 'elevation',
    metricType: 'elevation_m',
    hardnessStrategy: 'weighted',
    description: 'Cumulative elevation gain across race and training efforts.',
  },
  {
    code: 'A04',
    type: 'athlete',
    slug: 'podium-count',
    familyName: 'Podium Count',
    state: 'permanent',
    iconKey: 'podium',
    metricType: 'count',
    hardnessStrategy: 'weighted',
    description: 'Number of official podium finishes.',
  },
  {
    code: 'A05',
    type: 'athlete',
    slug: 'win-count',
    familyName: 'Win Count',
    state: 'permanent',
    iconKey: 'wins',
    metricType: 'count',
    hardnessStrategy: 'weighted',
    description: 'Number of official race wins.',
  },
  {
    code: 'A06',
    type: 'athlete',
    slug: 'category-win-count',
    familyName: 'Category Win Count',
    state: 'permanent',
    iconKey: 'category-win',
    metricType: 'count',
    hardnessStrategy: 'weighted',
    description: 'Number of category wins.',
  },
  {
    code: 'A07',
    type: 'athlete',
    slug: 'activity-streak',
    familyName: 'Activity Streak',
    state: 'permanent',
    iconKey: 'streak',
    metricType: 'count',
    hardnessStrategy: 'weighted',
    description: 'Consecutive active months with at least one official result or qualifying effort.',
  },
  {
    code: 'A08',
    type: 'athlete',
    slug: 'night-efforts',
    familyName: 'Night Efforts',
    state: 'permanent',
    iconKey: 'night',
    metricType: 'count',
    hardnessStrategy: 'direct',
    description: 'Count of qualifying night efforts or finishes.',
  },
  {
    code: 'A09',
    type: 'athlete',
    slug: 'speed-index',
    familyName: 'Speed Index',
    state: 'permanent',
    iconKey: 'speed',
    metricType: 'pace_sec_per_km',
    hardnessStrategy: 'direct',
    description: 'Best verified pace badge family.',
  },
  {
    code: 'A10',
    type: 'athlete',
    slug: 'long-single-effort-distance',
    familyName: 'Long Single Effort Distance',
    state: 'permanent',
    iconKey: 'single-effort-distance',
    metricType: 'distance_km',
    hardnessStrategy: 'direct',
    description: 'Longest qualifying single effort completed.',
  },
  {
    code: 'A11',
    type: 'athlete',
    slug: 'route-variety',
    familyName: 'Route Variety',
    state: 'permanent',
    iconKey: 'route-variety',
    metricType: 'count',
    hardnessStrategy: 'weighted',
    description: 'Unique named routes completed.',
  },
  {
    code: 'A12',
    type: 'athlete',
    slug: 'seasons-active',
    familyName: 'Seasons Active',
    state: 'permanent',
    iconKey: 'seasons',
    metricType: 'count',
    hardnessStrategy: 'fixed',
    description: 'Number of seasons in which the athlete was active.',
  },
  {
    code: 'T01',
    type: 'track',
    slug: 'track-finish-count',
    familyName: 'Route Finish Count',
    state: 'permanent',
    iconKey: 'track-finish',
    metricType: 'count',
    hardnessStrategy: 'direct',
    description: 'How many times a specific route was completed.',
  },
  {
    code: 'T02',
    type: 'track',
    slug: 'track-pb-improvement',
    familyName: 'Route PB Improvement',
    state: 'permanent',
    iconKey: 'track-pb',
    metricType: 'percent',
    hardnessStrategy: 'direct',
    description: 'Personal best improvement on a specific route.',
  },
  {
    code: 'T03',
    type: 'track',
    slug: 'track-all-time-rank',
    familyName: 'Route All-Time Rank',
    state: 'dynamic',
    iconKey: 'track-leaderboard',
    metricType: 'rank',
    hardnessStrategy: 'direct',
    description: 'Current all-time leaderboard position on a route.',
  },
  {
    code: 'T04',
    type: 'track',
    slug: 'track-season-rank',
    familyName: 'Route Season Rank',
    state: 'dynamic',
    iconKey: 'track-season-rank',
    metricType: 'rank',
    hardnessStrategy: 'direct',
    description: 'Current season leaderboard position on a route.',
  },
  {
    code: 'T05',
    type: 'track',
    slug: 'track-condition-coverage',
    familyName: 'Route Condition Coverage',
    state: 'permanent',
    iconKey: 'track-conditions',
    metricType: 'count',
    hardnessStrategy: 'direct',
    description: 'Distinct condition tags completed on the same route.',
  },
  {
    code: 'TM01',
    type: 'team',
    slug: 'team-appearances',
    familyName: 'Team Appearances',
    state: 'permanent',
    iconKey: 'team-appearances',
    metricType: 'count',
    hardnessStrategy: 'fixed',
    description: 'Number of team race appearances.',
  },
  {
    code: 'TM02',
    type: 'team',
    slug: 'team-scoring-rounds',
    familyName: 'Team Scoring Rounds',
    state: 'permanent',
    iconKey: 'team-scoring',
    metricType: 'count',
    hardnessStrategy: 'fixed',
    description: 'Rounds where the athlete was one of the team’s counted top 3 scorers.',
  },
  {
    code: 'TM03',
    type: 'team',
    slug: 'team-top-scorer-rounds',
    familyName: 'Team Top Scorer Rounds',
    state: 'permanent',
    iconKey: 'team-anchor',
    metricType: 'count',
    hardnessStrategy: 'fixed',
    description: 'Rounds where the athlete was the highest team scorer.',
  },
  {
    code: 'TM04',
    type: 'team',
    slug: 'team-clutch-scorer-rounds',
    familyName: 'Team Clutch Scorer Rounds',
    state: 'permanent',
    iconKey: 'team-clutch',
    metricType: 'count',
    hardnessStrategy: 'fixed',
    description: 'Rounds where the athlete was the exact 3rd and final counted scorer.',
  },
  {
    code: 'TM05',
    type: 'team',
    slug: 'team-round-podiums',
    familyName: 'Team Round Podiums',
    state: 'permanent',
    iconKey: 'team-podium',
    metricType: 'count',
    hardnessStrategy: 'fixed',
    description: 'Round podium finishes for the athlete’s team.',
  },
  {
    code: 'TM06',
    type: 'team',
    slug: 'team-round-wins',
    familyName: 'Team Round Wins',
    state: 'permanent',
    iconKey: 'team-wins',
    metricType: 'count',
    hardnessStrategy: 'fixed',
    description: 'Round wins for the athlete’s team.',
  },
  {
    code: 'TM07',
    type: 'team',
    slug: 'same-team-league-campaign',
    familyName: 'Same Team League Campaign',
    state: 'permanent',
    iconKey: 'team-campaign',
    metricType: 'campaign',
    hardnessStrategy: 'fixed',
    description: 'League campaign completion for the same team.',
  },
  {
    code: 'TM08',
    type: 'team',
    slug: 'final-team-season-rank',
    familyName: 'Final Team Season Rank',
    state: 'seasonal',
    iconKey: 'team-season-rank',
    metricType: 'rank',
    hardnessStrategy: 'fixed',
    description: 'Final team rank in season standings.',
  },
  {
    code: 'TM09',
    type: 'team',
    slug: 'team-titles-count',
    familyName: 'Team Titles Count',
    state: 'permanent',
    iconKey: 'team-titles',
    metricType: 'count',
    hardnessStrategy: 'fixed',
    description: 'Count of team season titles.',
  },
  {
    code: 'L01',
    type: 'league',
    slug: 'league-round-participation',
    familyName: 'League Round Participation',
    state: 'seasonal',
    iconKey: 'league-participation',
    metricType: 'campaign',
    hardnessStrategy: 'fixed',
    description: 'How many rounds of the current 6-race league have been completed.',
  },
  {
    code: 'L02',
    type: 'league',
    slug: 'live-league-rank',
    familyName: 'Live League Rank',
    state: 'dynamic',
    iconKey: 'league-live-rank',
    metricType: 'rank',
    hardnessStrategy: 'fixed',
    description: 'Current league standing during the active season.',
  },
  {
    code: 'L03',
    type: 'league',
    slug: 'final-league-rank',
    familyName: 'Final League Rank',
    state: 'seasonal',
    iconKey: 'league-final-rank',
    metricType: 'rank',
    hardnessStrategy: 'fixed',
    description: 'Final standing at the close of the season.',
  },
  {
    code: 'L04',
    type: 'league',
    slug: 'rounds-led',
    familyName: 'Rounds Led',
    state: 'seasonal',
    iconKey: 'league-led-rounds',
    metricType: 'count',
    hardnessStrategy: 'fixed',
    description: 'How many standings updates the athlete led after official updates.',
  },
  {
    code: 'L05',
    type: 'league',
    slug: 'league-momentum',
    familyName: 'League Momentum',
    state: 'seasonal',
    iconKey: 'league-momentum',
    metricType: 'rank',
    hardnessStrategy: 'fixed',
    description: 'Position gain or upward momentum in league standings.',
  },
  {
    code: 'L06',
    type: 'league',
    slug: 'league-round-wins',
    familyName: 'League Round Wins',
    state: 'seasonal',
    iconKey: 'league-round-wins',
    metricType: 'count',
    hardnessStrategy: 'fixed',
    description: 'Number of round wins in a season.',
  },
  {
    code: 'L07',
    type: 'league',
    slug: 'league-seasons-completed',
    familyName: 'League Seasons Completed',
    state: 'permanent',
    iconKey: 'league-seasons',
    metricType: 'count',
    hardnessStrategy: 'fixed',
    description: 'Number of league seasons completed by the athlete.',
  },
];

export const BADGE_DEFINITIONS: BadgeDefinitionSeed[] = [
  // Athlete
  {
    familyCode: 'A01',
    badgeType: 'athlete',
    slug: 'first-finish',
    name: 'First Finish',
    state: 'permanent',
    tierCode: 'M1',
    prestigeCode: 'P1',
    metricType: 'count',
    metricValue: 1,
    metricLabel: '1',
    iconKey: 'official-results',
    ruleType: 'count_threshold',
    hardnessStrategy: 'weighted',
    description: 'Awarded for the first official result.',
    ruleConfig: { metric: 'official_results_count', target: 1 },
  },
  {
    familyCode: 'A01', badgeType: 'athlete', slug: 'active-racer', name: 'Active Racer', state: 'permanent', tierCode: 'M2', prestigeCode: 'P1', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'official-results', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 10 official results.', ruleConfig: { metric: 'official_results_count', target: 10 },
  },
  {
    familyCode: 'A01', badgeType: 'athlete', slug: 'race-veteran', name: 'Race Veteran', state: 'permanent', tierCode: 'M3', prestigeCode: 'P2', metricType: 'count', metricValue: 25, metricLabel: '25', iconKey: 'official-results', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 25 official results.', ruleConfig: { metric: 'official_results_count', target: 25 },
  },
  {
    familyCode: 'A01', badgeType: 'athlete', slug: 'league-fixture', name: 'League Fixture', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 50, metricLabel: '50', iconKey: 'official-results', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 50 official results.', ruleConfig: { metric: 'official_results_count', target: 50 },
  },
  {
    familyCode: 'A01', badgeType: 'athlete', slug: 'century-racer', name: 'Century Racer', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 100, metricLabel: '100', iconKey: 'official-results', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 100 official results.', ruleConfig: { metric: 'official_results_count', target: 100 },
  },
  {
    familyCode: 'A02', badgeType: 'athlete', slug: 'first-steps', name: 'First Steps', state: 'permanent', tierCode: 'M1', prestigeCode: 'P1', metricType: 'distance_km', metricValue: 50, metricLabel: '50K', iconKey: 'distance', ruleType: 'sum_threshold', hardnessStrategy: 'weighted', description: 'Awarded for reaching 50 km total distance.', ruleConfig: { metric: 'total_distance_km', target: 50, sourceScope: ['race', 'training'] },
  },
  { familyCode: 'A02', badgeType: 'athlete', slug: 'distance-builder', name: 'Distance Builder', state: 'permanent', tierCode: 'M2', prestigeCode: 'P1', metricType: 'distance_km', metricValue: 100, metricLabel: '100K', iconKey: 'distance', ruleType: 'sum_threshold', hardnessStrategy: 'weighted', description: 'Awarded for reaching 100 km total distance.', ruleConfig: { metric: 'total_distance_km', target: 100, sourceScope: ['race', 'training'] } },
  { familyCode: 'A02', badgeType: 'athlete', slug: 'endurance-builder', name: 'Endurance Builder', state: 'permanent', tierCode: 'M3', prestigeCode: 'P2', metricType: 'distance_km', metricValue: 250, metricLabel: '250K', iconKey: 'distance', ruleType: 'sum_threshold', hardnessStrategy: 'weighted', description: 'Awarded for reaching 250 km total distance.', ruleConfig: { metric: 'total_distance_km', target: 250, sourceScope: ['race', 'training'] } },
  { familyCode: 'A02', badgeType: 'athlete', slug: 'iron-legs', name: 'Iron Legs', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'distance_km', metricValue: 500, metricLabel: '500K', iconKey: 'distance', ruleType: 'sum_threshold', hardnessStrategy: 'weighted', description: 'Awarded for reaching 500 km total distance.', ruleConfig: { metric: 'total_distance_km', target: 500, sourceScope: ['race', 'training'] } },
  { familyCode: 'A02', badgeType: 'athlete', slug: 'distance-machine', name: 'Distance Machine', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'distance_km', metricValue: 1000, metricLabel: '1M', iconKey: 'distance', ruleType: 'sum_threshold', hardnessStrategy: 'weighted', description: 'Awarded for reaching 1000 km total distance.', ruleConfig: { metric: 'total_distance_km', target: 1000, sourceScope: ['race', 'training'] } },
  { familyCode: 'A03', badgeType: 'athlete', slug: 'hill-taster', name: 'Hill Taster', state: 'permanent', tierCode: 'M1', prestigeCode: 'P1', metricType: 'elevation_m', metricValue: 1000, metricLabel: '1K↑', iconKey: 'elevation', ruleType: 'sum_threshold', hardnessStrategy: 'weighted', description: 'Awarded for reaching 1,000 m elevation gain.', ruleConfig: { metric: 'total_elevation_m', target: 1000, sourceScope: ['race', 'training'] } },
  { familyCode: 'A03', badgeType: 'athlete', slug: 'climb-builder', name: 'Climb Builder', state: 'permanent', tierCode: 'M2', prestigeCode: 'P1', metricType: 'elevation_m', metricValue: 5000, metricLabel: '5K↑', iconKey: 'elevation', ruleType: 'sum_threshold', hardnessStrategy: 'weighted', description: 'Awarded for reaching 5,000 m elevation gain.', ruleConfig: { metric: 'total_elevation_m', target: 5000, sourceScope: ['race', 'training'] } },
  { familyCode: 'A03', badgeType: 'athlete', slug: 'peak-chaser', name: 'Peak Chaser', state: 'permanent', tierCode: 'M3', prestigeCode: 'P2', metricType: 'elevation_m', metricValue: 10000, metricLabel: '10K↑', iconKey: 'elevation', ruleType: 'sum_threshold', hardnessStrategy: 'weighted', description: 'Awarded for reaching 10,000 m elevation gain.', ruleConfig: { metric: 'total_elevation_m', target: 10000, sourceScope: ['race', 'training'] } },
  { familyCode: 'A03', badgeType: 'athlete', slug: 'mountain-goat', name: 'Mountain Goat', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'elevation_m', metricValue: 25000, metricLabel: '25K↑', iconKey: 'elevation', ruleType: 'sum_threshold', hardnessStrategy: 'weighted', description: 'Awarded for reaching 25,000 m elevation gain.', ruleConfig: { metric: 'total_elevation_m', target: 25000, sourceScope: ['race', 'training'] } },
  { familyCode: 'A03', badgeType: 'athlete', slug: 'sky-collector', name: 'Sky Collector', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'elevation_m', metricValue: 50000, metricLabel: '50K↑', iconKey: 'elevation', ruleType: 'sum_threshold', hardnessStrategy: 'weighted', description: 'Awarded for reaching 50,000 m elevation gain.', ruleConfig: { metric: 'total_elevation_m', target: 50000, sourceScope: ['race', 'training'] } },
  { familyCode: 'A04', badgeType: 'athlete', slug: 'breakthrough', name: 'Breakthrough', state: 'permanent', tierCode: 'M1', prestigeCode: 'P2', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'podium', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for the first podium finish.', ruleConfig: { metric: 'official_podium_count', target: 1 } },
  { familyCode: 'A04', badgeType: 'athlete', slug: 'podium-regular', name: 'Podium Regular', state: 'permanent', tierCode: 'M2', prestigeCode: 'P2', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'podium', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 3 podium finishes.', ruleConfig: { metric: 'official_podium_count', target: 3 } },
  { familyCode: 'A04', badgeType: 'athlete', slug: 'top-step-threat', name: 'Top Step Threat', state: 'permanent', tierCode: 'M3', prestigeCode: 'P3', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'podium', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 5 podium finishes.', ruleConfig: { metric: 'official_podium_count', target: 5 } },
  { familyCode: 'A04', badgeType: 'athlete', slug: 'elite-presence', name: 'Elite Presence', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'podium', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 10 podium finishes.', ruleConfig: { metric: 'official_podium_count', target: 10 } },
  { familyCode: 'A04', badgeType: 'athlete', slug: 'podium-legend', name: 'Podium Legend', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 20, metricLabel: '20', iconKey: 'podium', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 20 podium finishes.', ruleConfig: { metric: 'official_podium_count', target: 20 } },
  { familyCode: 'A05', badgeType: 'athlete', slug: 'first-victory', name: 'First Victory', state: 'permanent', tierCode: 'M1', prestigeCode: 'P2', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'wins', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for the first official win.', ruleConfig: { metric: 'official_win_count', target: 1 } },
  { familyCode: 'A05', badgeType: 'athlete', slug: 'race-winner', name: 'Race Winner', state: 'permanent', tierCode: 'M2', prestigeCode: 'P2', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'wins', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 3 official wins.', ruleConfig: { metric: 'official_win_count', target: 3 } },
  { familyCode: 'A05', badgeType: 'athlete', slug: 'proven-winner', name: 'Proven Winner', state: 'permanent', tierCode: 'M3', prestigeCode: 'P3', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'wins', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 5 official wins.', ruleConfig: { metric: 'official_win_count', target: 5 } },
  { familyCode: 'A05', badgeType: 'athlete', slug: 'legend', name: 'Legend', state: 'permanent', tierCode: 'M4', prestigeCode: 'P4', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'wins', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 10 official wins.', ruleConfig: { metric: 'official_win_count', target: 10 } },
  { familyCode: 'A05', badgeType: 'athlete', slug: 'hall-of-fame', name: 'Hall of Fame', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 20, metricLabel: '20', iconKey: 'wins', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 20 official wins.', ruleConfig: { metric: 'official_win_count', target: 20 } },
  { familyCode: 'A06', badgeType: 'athlete', slug: 'category-winner', name: 'Category Winner', state: 'permanent', tierCode: 'M1', prestigeCode: 'P2', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'category-win', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for the first category win.', ruleConfig: { metric: 'category_win_count', target: 1 } },
  { familyCode: 'A06', badgeType: 'athlete', slug: 'category-regular', name: 'Category Regular', state: 'permanent', tierCode: 'M2', prestigeCode: 'P2', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'category-win', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 3 category wins.', ruleConfig: { metric: 'category_win_count', target: 3 } },
  { familyCode: 'A06', badgeType: 'athlete', slug: 'division-force', name: 'Division Force', state: 'permanent', tierCode: 'M3', prestigeCode: 'P3', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'category-win', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 5 category wins.', ruleConfig: { metric: 'category_win_count', target: 5 } },
  { familyCode: 'A06', badgeType: 'athlete', slug: 'category-master', name: 'Category Master', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'category-win', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 10 category wins.', ruleConfig: { metric: 'category_win_count', target: 10 } },
  { familyCode: 'A06', badgeType: 'athlete', slug: 'category-legend', name: 'Category Legend', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 20, metricLabel: '20', iconKey: 'category-win', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for 20 category wins.', ruleConfig: { metric: 'category_win_count', target: 20 } },
  { familyCode: 'A07', badgeType: 'athlete', slug: 'momentum', name: 'Momentum', state: 'permanent', tierCode: 'M1', prestigeCode: 'P1', metricType: 'count', metricValue: 2, metricLabel: '2', iconKey: 'streak', ruleType: 'consecutive_periods', hardnessStrategy: 'weighted', description: 'Awarded for 2 consecutive active months.', ruleConfig: { metric: 'active_months', target: 2, period: 'month' } },
  { familyCode: 'A07', badgeType: 'athlete', slug: 'on-a-roll', name: 'On a Roll', state: 'permanent', tierCode: 'M2', prestigeCode: 'P1', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'streak', ruleType: 'consecutive_periods', hardnessStrategy: 'weighted', description: 'Awarded for 3 consecutive active months.', ruleConfig: { metric: 'active_months', target: 3, period: 'month' } },
  { familyCode: 'A07', badgeType: 'athlete', slug: 'streak-master', name: 'Streak Master', state: 'permanent', tierCode: 'M3', prestigeCode: 'P2', metricType: 'count', metricValue: 6, metricLabel: '6', iconKey: 'streak', ruleType: 'consecutive_periods', hardnessStrategy: 'weighted', description: 'Awarded for 6 consecutive active months.', ruleConfig: { metric: 'active_months', target: 6, period: 'month' } },
  { familyCode: 'A07', badgeType: 'athlete', slug: 'unbroken', name: 'Unbroken', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 12, metricLabel: '12', iconKey: 'streak', ruleType: 'consecutive_periods', hardnessStrategy: 'weighted', description: 'Awarded for 12 consecutive active months.', ruleConfig: { metric: 'active_months', target: 12, period: 'month' } },
  { familyCode: 'A07', badgeType: 'athlete', slug: 'ever-moving', name: 'Ever Moving', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 24, metricLabel: '24', iconKey: 'streak', ruleType: 'consecutive_periods', hardnessStrategy: 'weighted', description: 'Awarded for 24 consecutive active months.', ruleConfig: { metric: 'active_months', target: 24, period: 'month' } },
  { familyCode: 'A08', badgeType: 'athlete', slug: 'night-runner', name: 'Night Runner', state: 'permanent', tierCode: 'M1', prestigeCode: 'P1', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'night', ruleType: 'event_flag_match', hardnessStrategy: 'direct', description: 'Awarded for the first qualifying night effort.', ruleConfig: { metric: 'night_efforts_count', target: 1, eventFlag: 'night' } },
  { familyCode: 'A08', badgeType: 'athlete', slug: 'moon-chaser', name: 'Moon Chaser', state: 'permanent', tierCode: 'M2', prestigeCode: 'P1', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'night', ruleType: 'count_threshold', hardnessStrategy: 'direct', description: 'Awarded for 3 qualifying night efforts.', ruleConfig: { metric: 'night_efforts_count', target: 3 } },
  { familyCode: 'A08', badgeType: 'athlete', slug: 'dark-trail-specialist', name: 'Dark Trail Specialist', state: 'permanent', tierCode: 'M3', prestigeCode: 'P2', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'night', ruleType: 'count_threshold', hardnessStrategy: 'direct', description: 'Awarded for 5 qualifying night efforts.', ruleConfig: { metric: 'night_efforts_count', target: 5 } },
  { familyCode: 'A08', badgeType: 'athlete', slug: 'night-veteran', name: 'Night Veteran', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'night', ruleType: 'count_threshold', hardnessStrategy: 'direct', description: 'Awarded for 10 qualifying night efforts.', ruleConfig: { metric: 'night_efforts_count', target: 10 } },
  { familyCode: 'A08', badgeType: 'athlete', slug: 'lord-of-the-night', name: 'Lord of the Night', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 20, metricLabel: '20', iconKey: 'night', ruleType: 'count_threshold', hardnessStrategy: 'direct', description: 'Awarded for 20 qualifying night efforts.', ruleConfig: { metric: 'night_efforts_count', target: 20 } },
  { familyCode: 'A09', badgeType: 'athlete', slug: 'fast-feet', name: 'Fast Feet', state: 'permanent', tierCode: 'M1', prestigeCode: 'P2', metricType: 'pace_sec_per_km', metricValue: 360, metricLabel: '6:00', iconKey: 'speed', ruleType: 'best_value_threshold', hardnessStrategy: 'direct', description: 'Awarded for verified pace of 6:00/km or faster.', ruleConfig: { metric: 'best_verified_pace_sec_per_km', targetMax: 360, minDistanceKm: 5 } },
  { familyCode: 'A09', badgeType: 'athlete', slug: 'speed-demon', name: 'Speed Demon', state: 'permanent', tierCode: 'M2', prestigeCode: 'P2', metricType: 'pace_sec_per_km', metricValue: 300, metricLabel: '5:00', iconKey: 'speed', ruleType: 'best_value_threshold', hardnessStrategy: 'direct', description: 'Awarded for verified pace of 5:00/km or faster.', ruleConfig: { metric: 'best_verified_pace_sec_per_km', targetMax: 300, minDistanceKm: 5 } },
  { familyCode: 'A09', badgeType: 'athlete', slug: 'blaze-pace', name: 'Blaze Pace', state: 'permanent', tierCode: 'M3', prestigeCode: 'P3', metricType: 'pace_sec_per_km', metricValue: 270, metricLabel: '4:30', iconKey: 'speed', ruleType: 'best_value_threshold', hardnessStrategy: 'direct', description: 'Awarded for verified pace of 4:30/km or faster.', ruleConfig: { metric: 'best_verified_pace_sec_per_km', targetMax: 270, minDistanceKm: 5 } },
  { familyCode: 'A09', badgeType: 'athlete', slug: 'lightning-legs', name: 'Lightning Legs', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'pace_sec_per_km', metricValue: 240, metricLabel: '4:00', iconKey: 'speed', ruleType: 'best_value_threshold', hardnessStrategy: 'direct', description: 'Awarded for verified pace of 4:00/km or faster.', ruleConfig: { metric: 'best_verified_pace_sec_per_km', targetMax: 240, minDistanceKm: 5 } },
  { familyCode: 'A09', badgeType: 'athlete', slug: 'warp-pace', name: 'Warp Pace', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'pace_sec_per_km', metricValue: 210, metricLabel: '3:30', iconKey: 'speed', ruleType: 'best_value_threshold', hardnessStrategy: 'direct', description: 'Awarded for verified pace of 3:30/km or faster.', ruleConfig: { metric: 'best_verified_pace_sec_per_km', targetMax: 210, minDistanceKm: 5 } },
  { familyCode: 'A10', badgeType: 'athlete', slug: 'half-hero', name: 'Half Hero', state: 'permanent', tierCode: 'M1', prestigeCode: 'P2', metricType: 'distance_km', metricValue: 21, metricLabel: '21K', iconKey: 'single-effort-distance', ruleType: 'best_value_threshold', hardnessStrategy: 'direct', description: 'Awarded for a single effort of at least 21 km.', ruleConfig: { metric: 'best_single_effort_distance_km', targetMin: 21 } },
  { familyCode: 'A10', badgeType: 'athlete', slug: 'marathon-marker', name: 'Marathon Marker', state: 'permanent', tierCode: 'M2', prestigeCode: 'P2', metricType: 'distance_km', metricValue: 42, metricLabel: '42K', iconKey: 'single-effort-distance', ruleType: 'best_value_threshold', hardnessStrategy: 'direct', description: 'Awarded for a single effort of at least 42 km.', ruleConfig: { metric: 'best_single_effort_distance_km', targetMin: 42 } },
  { familyCode: 'A10', badgeType: 'athlete', slug: 'ultra-finisher', name: 'Ultra Finisher', state: 'permanent', tierCode: 'M3', prestigeCode: 'P3', metricType: 'distance_km', metricValue: 50, metricLabel: '50K', iconKey: 'single-effort-distance', ruleType: 'best_value_threshold', hardnessStrategy: 'direct', description: 'Awarded for a single effort of at least 50 km.', ruleConfig: { metric: 'best_single_effort_distance_km', targetMin: 50 } },
  { familyCode: 'A10', badgeType: 'athlete', slug: 'ultra-veteran', name: 'Ultra Veteran', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'distance_km', metricValue: 75, metricLabel: '75K', iconKey: 'single-effort-distance', ruleType: 'best_value_threshold', hardnessStrategy: 'direct', description: 'Awarded for a single effort of at least 75 km.', ruleConfig: { metric: 'best_single_effort_distance_km', targetMin: 75 } },
  { familyCode: 'A10', badgeType: 'athlete', slug: 'hundred-club', name: 'Hundred Club', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'distance_km', metricValue: 100, metricLabel: '100K', iconKey: 'single-effort-distance', ruleType: 'best_value_threshold', hardnessStrategy: 'direct', description: 'Awarded for a single effort of at least 100 km.', ruleConfig: { metric: 'best_single_effort_distance_km', targetMin: 100 } },
  { familyCode: 'A11', badgeType: 'athlete', slug: 'local-explorer', name: 'Local Explorer', state: 'permanent', tierCode: 'M1', prestigeCode: 'P1', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'route-variety', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for completing 3 unique named routes.', ruleConfig: { metric: 'unique_route_count', target: 3 } },
  { familyCode: 'A11', badgeType: 'athlete', slug: 'trail-explorer', name: 'Trail Explorer', state: 'permanent', tierCode: 'M2', prestigeCode: 'P1', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'route-variety', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for completing 5 unique named routes.', ruleConfig: { metric: 'unique_route_count', target: 5 } },
  { familyCode: 'A11', badgeType: 'athlete', slug: 'region-roamer', name: 'Region Roamer', state: 'permanent', tierCode: 'M3', prestigeCode: 'P2', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'route-variety', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for completing 10 unique named routes.', ruleConfig: { metric: 'unique_route_count', target: 10 } },
  { familyCode: 'A11', badgeType: 'athlete', slug: 'cartographer', name: 'Cartographer', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 20, metricLabel: '20', iconKey: 'route-variety', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for completing 20 unique named routes.', ruleConfig: { metric: 'unique_route_count', target: 20 } },
  { familyCode: 'A11', badgeType: 'athlete', slug: 'trail-atlas', name: 'Trail Atlas', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 30, metricLabel: '30', iconKey: 'route-variety', ruleType: 'count_threshold', hardnessStrategy: 'weighted', description: 'Awarded for completing 30 unique named routes.', ruleConfig: { metric: 'unique_route_count', target: 30 } },
  { familyCode: 'A12', badgeType: 'athlete', slug: 'returner', name: 'Returner', state: 'permanent', tierCode: 'M1', prestigeCode: 'P1', metricType: 'count', metricValue: 2, metricLabel: '2', iconKey: 'seasons', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for being active in 2 seasons.', ruleConfig: { metric: 'seasons_active_count', target: 2 } },
  { familyCode: 'A12', badgeType: 'athlete', slug: 'multi-season-athlete', name: 'Multi-Season Athlete', state: 'permanent', tierCode: 'M2', prestigeCode: 'P2', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'seasons', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for being active in 3 seasons.', ruleConfig: { metric: 'seasons_active_count', target: 3 } },
  { familyCode: 'A12', badgeType: 'athlete', slug: 'seasoned-runner', name: 'Seasoned Runner', state: 'permanent', tierCode: 'M3', prestigeCode: 'P2', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'seasons', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for being active in 5 seasons.', ruleConfig: { metric: 'seasons_active_count', target: 5 } },
  { familyCode: 'A12', badgeType: 'athlete', slug: 'league-pillar', name: 'League Pillar', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 7, metricLabel: '7', iconKey: 'seasons', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for being active in 7 seasons.', ruleConfig: { metric: 'seasons_active_count', target: 7 } },
  { familyCode: 'A12', badgeType: 'athlete', slug: 'era-marker', name: 'Era Marker', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'seasons', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for being active in 10 seasons.', ruleConfig: { metric: 'seasons_active_count', target: 10 } },

  // Track
  { familyCode: 'T01', badgeType: 'track', slug: 'track-first-finish', name: 'First Finish', state: 'permanent', tierCode: 'M1', prestigeCode: 'P1', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'track-finish', ruleType: 'route_count_threshold', hardnessStrategy: 'direct', description: 'Awarded for the first finish on a specific route.', ruleConfig: { metric: 'track_finish_count', target: 1 } },
  { familyCode: 'T01', badgeType: 'track', slug: 'triple-finisher', name: 'Triple Finisher', state: 'permanent', tierCode: 'M2', prestigeCode: 'P1', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'track-finish', ruleType: 'route_count_threshold', hardnessStrategy: 'direct', description: 'Awarded for 3 finishes on the same route.', ruleConfig: { metric: 'track_finish_count', target: 3 } },
  { familyCode: 'T01', badgeType: 'track', slug: 'route-regular', name: 'Route Regular', state: 'permanent', tierCode: 'M3', prestigeCode: 'P2', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'track-finish', ruleType: 'route_count_threshold', hardnessStrategy: 'direct', description: 'Awarded for 5 finishes on the same route.', ruleConfig: { metric: 'track_finish_count', target: 5 } },
  { familyCode: 'T01', badgeType: 'track', slug: 'route-master', name: 'Route Master', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'track-finish', ruleType: 'route_count_threshold', hardnessStrategy: 'direct', description: 'Awarded for 10 finishes on the same route.', ruleConfig: { metric: 'track_finish_count', target: 10 } },
  { familyCode: 'T01', badgeType: 'track', slug: 'route-legend', name: 'Route Legend', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 25, metricLabel: '25', iconKey: 'track-finish', ruleType: 'route_count_threshold', hardnessStrategy: 'direct', description: 'Awarded for 25 finishes on the same route.', ruleConfig: { metric: 'track_finish_count', target: 25 } },
  { familyCode: 'T02', badgeType: 'track', slug: 'track-new-pb', name: 'New PB', state: 'permanent', tierCode: 'M1', prestigeCode: 'P1', metricType: 'percent', metricValue: true, metricLabel: 'PB', iconKey: 'track-pb', ruleType: 'route_best_threshold', hardnessStrategy: 'direct', description: 'Awarded for any improvement to the personal best on a route.', ruleConfig: { metric: 'track_pb_improved', target: true } },
  { familyCode: 'T02', badgeType: 'track', slug: 'track-5-percent-faster', name: '5% Faster', state: 'permanent', tierCode: 'M2', prestigeCode: 'P1', metricType: 'percent', metricValue: 5, metricLabel: '5%', iconKey: 'track-pb', ruleType: 'route_best_threshold', hardnessStrategy: 'direct', description: 'Awarded for improving route PB by 5%.', ruleConfig: { metric: 'track_pb_improvement_percent', targetMin: 5 } },
  { familyCode: 'T02', badgeType: 'track', slug: 'track-10-percent-faster', name: '10% Faster', state: 'permanent', tierCode: 'M3', prestigeCode: 'P2', metricType: 'percent', metricValue: 10, metricLabel: '10%', iconKey: 'track-pb', ruleType: 'route_best_threshold', hardnessStrategy: 'direct', description: 'Awarded for improving route PB by 10%.', ruleConfig: { metric: 'track_pb_improvement_percent', targetMin: 10 } },
  { familyCode: 'T02', badgeType: 'track', slug: 'track-15-percent-faster', name: '15% Faster', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'percent', metricValue: 15, metricLabel: '15%', iconKey: 'track-pb', ruleType: 'route_best_threshold', hardnessStrategy: 'direct', description: 'Awarded for improving route PB by 15%.', ruleConfig: { metric: 'track_pb_improvement_percent', targetMin: 15 } },
  { familyCode: 'T02', badgeType: 'track', slug: 'track-20-percent-faster', name: '20% Faster', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'percent', metricValue: 20, metricLabel: '20%', iconKey: 'track-pb', ruleType: 'route_best_threshold', hardnessStrategy: 'direct', description: 'Awarded for improving route PB by 20%.', ruleConfig: { metric: 'track_pb_improvement_percent', targetMin: 20 } },
  { familyCode: 'T03', badgeType: 'track', slug: 'top-50-time', name: 'Top 50 Time', state: 'dynamic', tierCode: 'M1', prestigeCode: 'P2', metricType: 'rank', metricValue: 50, metricLabel: 'T50', iconKey: 'track-leaderboard', ruleType: 'rank_range', hardnessStrategy: 'direct', description: 'Awarded for holding a Top 50 all-time time on a route.', ruleConfig: { metric: 'track_all_time_rank', minRank: 1, maxRank: 50 } },
  { familyCode: 'T03', badgeType: 'track', slug: 'top-25-time', name: 'Top 25 Time', state: 'dynamic', tierCode: 'M2', prestigeCode: 'P2', metricType: 'rank', metricValue: 25, metricLabel: 'T25', iconKey: 'track-leaderboard', ruleType: 'rank_range', hardnessStrategy: 'direct', description: 'Awarded for holding a Top 25 all-time time on a route.', ruleConfig: { metric: 'track_all_time_rank', minRank: 1, maxRank: 25 } },
  { familyCode: 'T03', badgeType: 'track', slug: 'top-10-time', name: 'Top 10 Time', state: 'dynamic', tierCode: 'M3', prestigeCode: 'P3', metricType: 'rank', metricValue: 10, metricLabel: 'T10', iconKey: 'track-leaderboard', ruleType: 'rank_range', hardnessStrategy: 'direct', description: 'Awarded for holding a Top 10 all-time time on a route.', ruleConfig: { metric: 'track_all_time_rank', minRank: 1, maxRank: 10 } },
  { familyCode: 'T03', badgeType: 'track', slug: 'top-3-time', name: 'Top 3 Time', state: 'dynamic', tierCode: 'M4', prestigeCode: 'P3', metricType: 'rank', metricValue: 3, metricLabel: 'T3', iconKey: 'track-leaderboard', ruleType: 'rank_range', hardnessStrategy: 'direct', description: 'Awarded for holding a Top 3 all-time time on a route.', ruleConfig: { metric: 'track_all_time_rank', minRank: 1, maxRank: 3 } },
  { familyCode: 'T03', badgeType: 'track', slug: 'route-record-holder', name: 'Route Record Holder', state: 'dynamic', tierCode: 'M5', prestigeCode: 'P4', metricType: 'rank', metricValue: 1, metricLabel: '#1', iconKey: 'track-leaderboard', ruleType: 'rank_range', hardnessStrategy: 'direct', description: 'Awarded for holding the all-time route record.', ruleConfig: { metric: 'track_all_time_rank', minRank: 1, maxRank: 1 } },
  { familyCode: 'T04', badgeType: 'track', slug: 'season-top-20', name: 'Season Top 20', state: 'dynamic', tierCode: 'M1', prestigeCode: 'P2', metricType: 'rank', metricValue: 20, metricLabel: 'T20', iconKey: 'track-season-rank', ruleType: 'rank_range', hardnessStrategy: 'direct', description: 'Awarded for holding a Top 20 season time on a route.', ruleConfig: { metric: 'track_season_rank', minRank: 1, maxRank: 20 } },
  { familyCode: 'T04', badgeType: 'track', slug: 'season-top-10', name: 'Season Top 10', state: 'dynamic', tierCode: 'M2', prestigeCode: 'P2', metricType: 'rank', metricValue: 10, metricLabel: 'T10', iconKey: 'track-season-rank', ruleType: 'rank_range', hardnessStrategy: 'direct', description: 'Awarded for holding a Top 10 season time on a route.', ruleConfig: { metric: 'track_season_rank', minRank: 1, maxRank: 10 } },
  { familyCode: 'T04', badgeType: 'track', slug: 'season-top-5', name: 'Season Top 5', state: 'dynamic', tierCode: 'M3', prestigeCode: 'P3', metricType: 'rank', metricValue: 5, metricLabel: 'T5', iconKey: 'track-season-rank', ruleType: 'rank_range', hardnessStrategy: 'direct', description: 'Awarded for holding a Top 5 season time on a route.', ruleConfig: { metric: 'track_season_rank', minRank: 1, maxRank: 5 } },
  { familyCode: 'T04', badgeType: 'track', slug: 'season-top-3', name: 'Season Top 3', state: 'dynamic', tierCode: 'M4', prestigeCode: 'P3', metricType: 'rank', metricValue: 3, metricLabel: 'T3', iconKey: 'track-season-rank', ruleType: 'rank_range', hardnessStrategy: 'direct', description: 'Awarded for holding a Top 3 season time on a route.', ruleConfig: { metric: 'track_season_rank', minRank: 1, maxRank: 3 } },
  { familyCode: 'T04', badgeType: 'track', slug: 'fastest-this-season', name: 'Fastest This Season', state: 'dynamic', tierCode: 'M5', prestigeCode: 'P4', metricType: 'rank', metricValue: 1, metricLabel: '#1', iconKey: 'track-season-rank', ruleType: 'rank_range', hardnessStrategy: 'direct', description: 'Awarded for holding the best season time on a route.', ruleConfig: { metric: 'track_season_rank', minRank: 1, maxRank: 1 } },
  { familyCode: 'T05', badgeType: 'track', slug: 'dual-conditions', name: 'Dual Conditions', state: 'permanent', tierCode: 'M1', prestigeCode: 'P1', metricType: 'count', metricValue: 2, metricLabel: '2', iconKey: 'track-conditions', ruleType: 'count_threshold', hardnessStrategy: 'direct', description: 'Awarded for completing the same route in 2 distinct conditions.', ruleConfig: { metric: 'track_distinct_condition_count', target: 2 } },
  { familyCode: 'T05', badgeType: 'track', slug: 'light-collector', name: 'Light Collector', state: 'permanent', tierCode: 'M2', prestigeCode: 'P1', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'track-conditions', ruleType: 'count_threshold', hardnessStrategy: 'direct', description: 'Awarded for completing the same route in 3 distinct conditions.', ruleConfig: { metric: 'track_distinct_condition_count', target: 3 } },
  { familyCode: 'T05', badgeType: 'track', slug: 'weathered-route', name: 'Weathered Route', state: 'permanent', tierCode: 'M3', prestigeCode: 'P2', metricType: 'count', metricValue: 4, metricLabel: '4', iconKey: 'track-conditions', ruleType: 'count_threshold', hardnessStrategy: 'direct', description: 'Awarded for completing the same route in 4 distinct conditions.', ruleConfig: { metric: 'track_distinct_condition_count', target: 4 } },
  { familyCode: 'T05', badgeType: 'track', slug: 'all-conditions', name: 'All Conditions', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'track-conditions', ruleType: 'count_threshold', hardnessStrategy: 'direct', description: 'Awarded for completing the same route in 5 distinct conditions.', ruleConfig: { metric: 'track_distinct_condition_count', target: 5 } },
  { familyCode: 'T05', badgeType: 'track', slug: 'route-elementalist', name: 'Route Elementalist', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 6, metricLabel: '6', iconKey: 'track-conditions', ruleType: 'count_threshold', hardnessStrategy: 'direct', description: 'Awarded for completing the same route in 6 distinct conditions.', ruleConfig: { metric: 'track_distinct_condition_count', target: 6 } },

  // Team
  { familyCode: 'TM01', badgeType: 'team', slug: 'team-starter', name: 'Team Starter', state: 'permanent', tierCode: 'M1', prestigeCode: 'P1', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'team-appearances', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for the first team race appearance.', ruleConfig: { metric: 'team_race_appearances', target: 1 } },
  { familyCode: 'TM01', badgeType: 'team', slug: 'team-regular', name: 'Team Regular', state: 'permanent', tierCode: 'M2', prestigeCode: 'P1', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'team-appearances', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for 3 team race appearances.', ruleConfig: { metric: 'team_race_appearances', target: 3 } },
  { familyCode: 'TM01', badgeType: 'team', slug: 'team-loyalist', name: 'Team Loyalist', state: 'permanent', tierCode: 'M3', prestigeCode: 'P2', metricType: 'count', metricValue: 6, metricLabel: '6', iconKey: 'team-appearances', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for 6 team race appearances.', ruleConfig: { metric: 'team_race_appearances', target: 6 } },
  { familyCode: 'TM01', badgeType: 'team', slug: 'team-pillar', name: 'Team Pillar', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'team-appearances', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for 10 team race appearances.', ruleConfig: { metric: 'team_race_appearances', target: 10 } },
  { familyCode: 'TM01', badgeType: 'team', slug: 'team-lifeblood', name: 'Team Lifeblood', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 20, metricLabel: '20', iconKey: 'team-appearances', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for 20 team race appearances.', ruleConfig: { metric: 'team_race_appearances', target: 20 } },
  { familyCode: 'TM02', badgeType: 'team', slug: 'point-scorer', name: 'Point Scorer', state: 'permanent', tierCode: 'M1', prestigeCode: 'P2', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'team-scoring', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for being a counted team scorer in 1 round.', ruleConfig: { metric: 'team_scoring_round_count', target: 1 } },
  { familyCode: 'TM02', badgeType: 'team', slug: 'reliable-scorer', name: 'Reliable Scorer', state: 'permanent', tierCode: 'M2', prestigeCode: 'P2', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'team-scoring', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for being a counted team scorer in 3 rounds.', ruleConfig: { metric: 'team_scoring_round_count', target: 3 } },
  { familyCode: 'TM02', badgeType: 'team', slug: 'core-three', name: 'Core Three', state: 'permanent', tierCode: 'M3', prestigeCode: 'P3', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'team-scoring', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for being a counted team scorer in 5 rounds.', ruleConfig: { metric: 'team_scoring_round_count', target: 5 } },
  { familyCode: 'TM02', badgeType: 'team', slug: 'season-backbone', name: 'Season Backbone', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'team-scoring', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for being a counted team scorer in 10 rounds.', ruleConfig: { metric: 'team_scoring_round_count', target: 10 } },
  { familyCode: 'TM02', badgeType: 'team', slug: 'franchise-scorer', name: 'Franchise Scorer', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 20, metricLabel: '20', iconKey: 'team-scoring', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for being a counted team scorer in 20 rounds.', ruleConfig: { metric: 'team_scoring_round_count', target: 20 } },
  { familyCode: 'TM03', badgeType: 'team', slug: 'team-anchor', name: 'Team Anchor', state: 'permanent', tierCode: 'M1', prestigeCode: 'P2', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'team-anchor', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for finishing as the highest team scorer in 1 round.', ruleConfig: { metric: 'team_top_scorer_round_count', target: 1 } },
  { familyCode: 'TM03', badgeType: 'team', slug: 'iron-anchor', name: 'Iron Anchor', state: 'permanent', tierCode: 'M2', prestigeCode: 'P2', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'team-anchor', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for finishing as the highest team scorer in 3 rounds.', ruleConfig: { metric: 'team_top_scorer_round_count', target: 3 } },
  { familyCode: 'TM03', badgeType: 'team', slug: 'lead-engine', name: 'Lead Engine', state: 'permanent', tierCode: 'M3', prestigeCode: 'P3', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'team-anchor', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for finishing as the highest team scorer in 5 rounds.', ruleConfig: { metric: 'team_top_scorer_round_count', target: 5 } },
  { familyCode: 'TM03', badgeType: 'team', slug: 'team-commander', name: 'Team Commander', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'team-anchor', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for finishing as the highest team scorer in 10 rounds.', ruleConfig: { metric: 'team_top_scorer_round_count', target: 10 } },
  { familyCode: 'TM03', badgeType: 'team', slug: 'dynasty-anchor', name: 'Dynasty Anchor', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 20, metricLabel: '20', iconKey: 'team-anchor', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for finishing as the highest team scorer in 20 rounds.', ruleConfig: { metric: 'team_top_scorer_round_count', target: 20 } },
  { familyCode: 'TM04', badgeType: 'team', slug: 'clutch-scorer', name: 'Clutch Scorer', state: 'permanent', tierCode: 'M1', prestigeCode: 'P2', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'team-clutch', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for being the exact 3rd and final counted scorer in 1 round.', ruleConfig: { metric: 'team_clutch_scorer_round_count', target: 1 } },
  { familyCode: 'TM04', badgeType: 'team', slug: 'clutch-specialist', name: 'Clutch Specialist', state: 'permanent', tierCode: 'M2', prestigeCode: 'P2', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'team-clutch', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for being the exact 3rd and final counted scorer in 3 rounds.', ruleConfig: { metric: 'team_clutch_scorer_round_count', target: 3 } },
  { familyCode: 'TM04', badgeType: 'team', slug: 'pressure-runner', name: 'Pressure Runner', state: 'permanent', tierCode: 'M3', prestigeCode: 'P3', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'team-clutch', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for being the exact 3rd and final counted scorer in 5 rounds.', ruleConfig: { metric: 'team_clutch_scorer_round_count', target: 5 } },
  { familyCode: 'TM04', badgeType: 'team', slug: 'closing-machine', name: 'Closing Machine', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'team-clutch', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for being the exact 3rd and final counted scorer in 10 rounds.', ruleConfig: { metric: 'team_clutch_scorer_round_count', target: 10 } },
  { familyCode: 'TM04', badgeType: 'team', slug: 'ice-veins', name: 'Ice Veins', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 20, metricLabel: '20', iconKey: 'team-clutch', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for being the exact 3rd and final counted scorer in 20 rounds.', ruleConfig: { metric: 'team_clutch_scorer_round_count', target: 20 } },
  { familyCode: 'TM05', badgeType: 'team', slug: 'team-podium', name: 'Team Podium', state: 'permanent', tierCode: 'M1', prestigeCode: 'P2', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'team-podium', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for being part of a team round podium once.', ruleConfig: { metric: 'team_round_podium_count', target: 1 } },
  { familyCode: 'TM05', badgeType: 'team', slug: 'podium-squad', name: 'Podium Squad', state: 'permanent', tierCode: 'M2', prestigeCode: 'P2', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'team-podium', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for being part of a team round podium 3 times.', ruleConfig: { metric: 'team_round_podium_count', target: 3 } },
  { familyCode: 'TM05', badgeType: 'team', slug: 'medal-machine', name: 'Medal Machine', state: 'permanent', tierCode: 'M3', prestigeCode: 'P3', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'team-podium', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for being part of a team round podium 5 times.', ruleConfig: { metric: 'team_round_podium_count', target: 5 } },
  { familyCode: 'TM05', badgeType: 'team', slug: 'podium-force', name: 'Podium Force', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'team-podium', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for being part of a team round podium 10 times.', ruleConfig: { metric: 'team_round_podium_count', target: 10 } },
  { familyCode: 'TM05', badgeType: 'team', slug: 'podium-dynasty', name: 'Podium Dynasty', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 20, metricLabel: '20', iconKey: 'team-podium', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for being part of a team round podium 20 times.', ruleConfig: { metric: 'team_round_podium_count', target: 20 } },
  { familyCode: 'TM06', badgeType: 'team', slug: 'team-winner', name: 'Team Winner', state: 'permanent', tierCode: 'M1', prestigeCode: 'P3', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'team-wins', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for being part of a team round win once.', ruleConfig: { metric: 'team_round_win_count', target: 1 } },
  { familyCode: 'TM06', badgeType: 'team', slug: 'winning-squad', name: 'Winning Squad', state: 'permanent', tierCode: 'M2', prestigeCode: 'P3', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'team-wins', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for being part of a team round win 3 times.', ruleConfig: { metric: 'team_round_win_count', target: 3 } },
  { familyCode: 'TM06', badgeType: 'team', slug: 'round-crushers', name: 'Round Crushers', state: 'permanent', tierCode: 'M3', prestigeCode: 'P3', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'team-wins', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for being part of a team round win 5 times.', ruleConfig: { metric: 'team_round_win_count', target: 5 } },
  { familyCode: 'TM06', badgeType: 'team', slug: 'winning-culture', name: 'Winning Culture', state: 'permanent', tierCode: 'M4', prestigeCode: 'P4', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'team-wins', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for being part of a team round win 10 times.', ruleConfig: { metric: 'team_round_win_count', target: 10 } },
  { familyCode: 'TM06', badgeType: 'team', slug: 'win-dynasty', name: 'Win Dynasty', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 20, metricLabel: '20', iconKey: 'team-wins', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for being part of a team round win 20 times.', ruleConfig: { metric: 'team_round_win_count', target: 20 } },
  { familyCode: 'TM07', badgeType: 'team', slug: 'present-for-the-team', name: 'Present for the Team', state: 'permanent', tierCode: 'M1', prestigeCode: 'P1', metricType: 'campaign', metricValue: '3/6', metricLabel: '3/6', iconKey: 'team-campaign', ruleType: 'season_progress_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for completing 3 of 6 league rounds for the same team.', ruleConfig: { metric: 'same_team_league_rounds_completed', target: 3, seasonRounds: 6 } },
  { familyCode: 'TM07', badgeType: 'team', slug: 'team-engine', name: 'Team Engine', state: 'permanent', tierCode: 'M2', prestigeCode: 'P2', metricType: 'campaign', metricValue: '6/6', metricLabel: '6/6', iconKey: 'team-campaign', ruleType: 'season_progress_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for completing all 6 league rounds for the same team.', ruleConfig: { metric: 'same_team_league_rounds_completed', target: 6, seasonRounds: 6 } },
  { familyCode: 'TM07', badgeType: 'team', slug: 'campaign-backbone', name: 'Campaign Backbone', state: 'permanent', tierCode: 'M3', prestigeCode: 'P3', metricType: 'count', metricValue: 2, metricLabel: '2x', iconKey: 'team-campaign', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for completing 2 full league campaigns for the same team.', ruleConfig: { metric: 'same_team_full_campaign_count', target: 2 } },
  { familyCode: 'TM07', badgeType: 'team', slug: 'club-pillar', name: 'Club Pillar', state: 'permanent', tierCode: 'M4', prestigeCode: 'P3', metricType: 'count', metricValue: 3, metricLabel: '3x', iconKey: 'team-campaign', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for completing 3 full league campaigns for the same team.', ruleConfig: { metric: 'same_team_full_campaign_count', target: 3 } },
  { familyCode: 'TM07', badgeType: 'team', slug: 'team-icon', name: 'Team Icon', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 5, metricLabel: '5x', iconKey: 'team-campaign', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for completing 5 full league campaigns for the same team.', ruleConfig: { metric: 'same_team_full_campaign_count', target: 5 } },
  { familyCode: 'TM08', badgeType: 'team', slug: 'top-10-team-member', name: 'Top 10 Team Member', state: 'seasonal', tierCode: 'M1', prestigeCode: 'P2', metricType: 'rank', metricValue: 10, metricLabel: 'T10', iconKey: 'team-season-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for being on a team that finishes in the Top 10.', ruleConfig: { metric: 'final_team_rank', minRank: 1, maxRank: 10, minParticipationRounds: 1 } },
  { familyCode: 'TM08', badgeType: 'team', slug: 'top-5-team-member', name: 'Top 5 Team Member', state: 'seasonal', tierCode: 'M2', prestigeCode: 'P2', metricType: 'rank', metricValue: 5, metricLabel: 'T5', iconKey: 'team-season-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for being on a team that finishes in the Top 5.', ruleConfig: { metric: 'final_team_rank', minRank: 1, maxRank: 5, minParticipationRounds: 1 } },
  { familyCode: 'TM08', badgeType: 'team', slug: 'team-medalist', name: 'Team Medalist', state: 'seasonal', tierCode: 'M3', prestigeCode: 'P3', metricType: 'rank', metricValue: 3, metricLabel: 'T3', iconKey: 'team-season-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for being on a team that finishes on the podium.', ruleConfig: { metric: 'final_team_rank', minRank: 1, maxRank: 3, minParticipationRounds: 3 } },
  { familyCode: 'TM08', badgeType: 'team', slug: 'team-champion', name: 'Team Champion', state: 'seasonal', tierCode: 'M4', prestigeCode: 'P4', metricType: 'rank', metricValue: 1, metricLabel: '#1', iconKey: 'team-season-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for being on the team that wins the season.', ruleConfig: { metric: 'final_team_rank', minRank: 1, maxRank: 1, minParticipationRounds: 3 } },
  { familyCode: 'TM08', badgeType: 'team', slug: 'invincible-team-member', name: 'Invincible Team Member', state: 'seasonal', tierCode: 'M5', prestigeCode: 'P4', metricType: 'boolean', metricValue: true, metricLabel: 'INV', iconKey: 'team-season-rank', ruleType: 'manual_admin_award', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for being on a dominant title-winning team with full campaign and scoring contribution.', ruleConfig: { metric: 'invincible_team_member', requires: ['final_team_rank_1', 'team_scoring_round_count>=6', 'same_team_league_rounds_completed=6', 'team_round_win_count>=3'] } },
  { familyCode: 'TM09', badgeType: 'team', slug: 'champions-ring', name: 'Champions Ring', state: 'permanent', tierCode: 'M1', prestigeCode: 'P3', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'team-titles', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for 1 team season title.', ruleConfig: { metric: 'team_titles_count', target: 1 } },
  { familyCode: 'TM09', badgeType: 'team', slug: 'double-crown', name: 'Double Crown', state: 'permanent', tierCode: 'M2', prestigeCode: 'P3', metricType: 'count', metricValue: 2, metricLabel: '2', iconKey: 'team-titles', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for 2 team season titles.', ruleConfig: { metric: 'team_titles_count', target: 2 } },
  { familyCode: 'TM09', badgeType: 'team', slug: 'team-dynasty', name: 'Team Dynasty', state: 'permanent', tierCode: 'M3', prestigeCode: 'P4', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'team-titles', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for 3 team season titles.', ruleConfig: { metric: 'team_titles_count', target: 3 } },
  { familyCode: 'TM09', badgeType: 'team', slug: 'golden-era', name: 'Golden Era', state: 'permanent', tierCode: 'M4', prestigeCode: 'P4', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'team-titles', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for 5 team season titles.', ruleConfig: { metric: 'team_titles_count', target: 5 } },
  { familyCode: 'TM09', badgeType: 'team', slug: 'hall-of-teams', name: 'Hall of Teams', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'team-titles', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for 10 team season titles.', ruleConfig: { metric: 'team_titles_count', target: 10 } },

  // League
  { familyCode: 'L01', badgeType: 'league', slug: 'league-starter', name: 'League Starter', state: 'seasonal', tierCode: 'M1', prestigeCode: 'P1', metricType: 'campaign', metricValue: '1/6', metricLabel: '1/6', iconKey: 'league-participation', ruleType: 'season_progress_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for completing the first round of a 6-race league.', ruleConfig: { metric: 'league_rounds_completed', target: 1, seasonRounds: 6 } },
  { familyCode: 'L01', badgeType: 'league', slug: 'league-runner', name: 'League Runner', state: 'seasonal', tierCode: 'M2', prestigeCode: 'P1', metricType: 'campaign', metricValue: '2/6', metricLabel: '2/6', iconKey: 'league-participation', ruleType: 'season_progress_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for completing 2 rounds of a 6-race league.', ruleConfig: { metric: 'league_rounds_completed', target: 2, seasonRounds: 6 } },
  { familyCode: 'L01', badgeType: 'league', slug: 'halfway-there', name: 'Halfway There', state: 'seasonal', tierCode: 'M3', prestigeCode: 'P2', metricType: 'campaign', metricValue: '3/6', metricLabel: '3/6', iconKey: 'league-participation', ruleType: 'season_progress_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for completing 3 rounds of a 6-race league.', ruleConfig: { metric: 'league_rounds_completed', target: 3, seasonRounds: 6 } },
  { familyCode: 'L01', badgeType: 'league', slug: 'league-committed', name: 'League Committed', state: 'seasonal', tierCode: 'M4', prestigeCode: 'P3', metricType: 'campaign', metricValue: '5/6', metricLabel: '5/6', iconKey: 'league-participation', ruleType: 'season_progress_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for completing 5 rounds of a 6-race league.', ruleConfig: { metric: 'league_rounds_completed', target: 5, seasonRounds: 6 } },
  { familyCode: 'L01', badgeType: 'league', slug: 'six-of-six', name: 'Six of Six', state: 'seasonal', tierCode: 'M5', prestigeCode: 'P4', metricType: 'campaign', metricValue: '6/6', metricLabel: '6/6', iconKey: 'league-participation', ruleType: 'season_progress_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for completing all 6 rounds of the league.', ruleConfig: { metric: 'league_rounds_completed', target: 6, seasonRounds: 6 } },
  { familyCode: 'L02', badgeType: 'league', slug: 'top-20-league', name: 'Top 20 League', state: 'dynamic', tierCode: 'M1', prestigeCode: 'P2', metricType: 'rank', metricValue: 20, metricLabel: 'T20', iconKey: 'league-live-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for holding a live Top 20 league rank.', ruleConfig: { metric: 'live_league_rank', minRank: 1, maxRank: 20 } },
  { familyCode: 'L02', badgeType: 'league', slug: 'top-10-league', name: 'Top 10 League', state: 'dynamic', tierCode: 'M2', prestigeCode: 'P2', metricType: 'rank', metricValue: 10, metricLabel: 'T10', iconKey: 'league-live-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for holding a live Top 10 league rank.', ruleConfig: { metric: 'live_league_rank', minRank: 1, maxRank: 10 } },
  { familyCode: 'L02', badgeType: 'league', slug: 'top-5-league', name: 'Top 5 League', state: 'dynamic', tierCode: 'M3', prestigeCode: 'P3', metricType: 'rank', metricValue: 5, metricLabel: 'T5', iconKey: 'league-live-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for holding a live Top 5 league rank.', ruleConfig: { metric: 'live_league_rank', minRank: 1, maxRank: 5 } },
  { familyCode: 'L02', badgeType: 'league', slug: 'season-leader', name: 'Season Leader', state: 'dynamic', tierCode: 'M4', prestigeCode: 'P3', metricType: 'rank', metricValue: 3, metricLabel: 'T3', iconKey: 'league-live-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for holding a live Top 3 league rank.', ruleConfig: { metric: 'live_league_rank', minRank: 1, maxRank: 3 } },
  { familyCode: 'L02', badgeType: 'league', slug: 'yellow-jersey-live', name: 'Yellow Jersey', state: 'dynamic', tierCode: 'M5', prestigeCode: 'P4', metricType: 'rank', metricValue: 1, metricLabel: '#1', iconKey: 'league-live-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for holding 1st place in the live league standings.', ruleConfig: { metric: 'live_league_rank', minRank: 1, maxRank: 1 } },
  { familyCode: 'L03', badgeType: 'league', slug: 'final-top-20', name: 'Final Top 20', state: 'seasonal', tierCode: 'M1', prestigeCode: 'P2', metricType: 'rank', metricValue: 20, metricLabel: 'T20', iconKey: 'league-final-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for finishing the season in the Top 20.', ruleConfig: { metric: 'final_league_rank', minRank: 1, maxRank: 20 } },
  { familyCode: 'L03', badgeType: 'league', slug: 'final-top-10', name: 'Final Top 10', state: 'seasonal', tierCode: 'M2', prestigeCode: 'P2', metricType: 'rank', metricValue: 10, metricLabel: 'T10', iconKey: 'league-final-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for finishing the season in the Top 10.', ruleConfig: { metric: 'final_league_rank', minRank: 1, maxRank: 10 } },
  { familyCode: 'L03', badgeType: 'league', slug: 'final-top-5', name: 'Final Top 5', state: 'seasonal', tierCode: 'M3', prestigeCode: 'P3', metricType: 'rank', metricValue: 5, metricLabel: 'T5', iconKey: 'league-final-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for finishing the season in the Top 5.', ruleConfig: { metric: 'final_league_rank', minRank: 1, maxRank: 5 } },
  { familyCode: 'L03', badgeType: 'league', slug: 'league-podium', name: 'League Podium', state: 'seasonal', tierCode: 'M4', prestigeCode: 'P4', metricType: 'rank', metricValue: 3, metricLabel: 'T3', iconKey: 'league-final-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for finishing the season on the league podium.', ruleConfig: { metric: 'final_league_rank', minRank: 1, maxRank: 3 } },
  { familyCode: 'L03', badgeType: 'league', slug: 'league-champion', name: 'League Champion', state: 'seasonal', tierCode: 'M5', prestigeCode: 'P4', metricType: 'rank', metricValue: 1, metricLabel: '#1', iconKey: 'league-final-rank', ruleType: 'rank_range', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for winning the league season.', ruleConfig: { metric: 'final_league_rank', minRank: 1, maxRank: 1 } },
  { familyCode: 'L04', badgeType: 'league', slug: 'yellow-jersey-round-led', name: 'Yellow Jersey', state: 'seasonal', tierCode: 'M1', prestigeCode: 'P2', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'league-led-rounds', ruleType: 'season_rounds_led_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for leading the standings after 1 official update.', ruleConfig: { metric: 'rounds_led_count', target: 1 } },
  { familyCode: 'L04', badgeType: 'league', slug: 'held-the-lead', name: 'Held the Lead', state: 'seasonal', tierCode: 'M2', prestigeCode: 'P3', metricType: 'count', metricValue: 2, metricLabel: '2', iconKey: 'league-led-rounds', ruleType: 'season_rounds_led_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for leading the standings after 2 official updates.', ruleConfig: { metric: 'rounds_led_count', target: 2 } },
  { familyCode: 'L04', badgeType: 'league', slug: 'leaders-grip', name: 'Leader’s Grip', state: 'seasonal', tierCode: 'M3', prestigeCode: 'P3', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'league-led-rounds', ruleType: 'season_rounds_led_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for leading the standings after 3 official updates.', ruleConfig: { metric: 'rounds_led_count', target: 3 } },
  { familyCode: 'L04', badgeType: 'league', slug: 'dominant-leader', name: 'Dominant Leader', state: 'seasonal', tierCode: 'M4', prestigeCode: 'P4', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'league-led-rounds', ruleType: 'season_rounds_led_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for leading the standings after 5 official updates.', ruleConfig: { metric: 'rounds_led_count', target: 5 } },
  { familyCode: 'L04', badgeType: 'league', slug: 'wire-to-wire', name: 'Wire-to-Wire', state: 'seasonal', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 6, metricLabel: '6', iconKey: 'league-led-rounds', ruleType: 'season_rounds_led_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for leading the standings after all 6 official updates.', ruleConfig: { metric: 'rounds_led_count', target: 6, seasonRounds: 6 } },
  { familyCode: 'L05', badgeType: 'league', slug: 'on-the-rise', name: 'On the Rise', state: 'seasonal', tierCode: 'M1', prestigeCode: 'P1', metricType: 'count', metricValue: 2, metricLabel: '2↑', iconKey: 'league-momentum', ruleType: 'position_gain_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for improving rank across 2 consecutive updates.', ruleConfig: { metric: 'consecutive_rank_improvement_updates', target: 2 } },
  { familyCode: 'L05', badgeType: 'league', slug: 'climber', name: 'Climber', state: 'seasonal', tierCode: 'M2', prestigeCode: 'P2', metricType: 'rank', metricValue: 5, metricLabel: '+5', iconKey: 'league-momentum', ruleType: 'position_gain_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for gaining 5 places in league standings.', ruleConfig: { metric: 'max_position_gain_single_season', target: 5 } },
  { familyCode: 'L05', badgeType: 'league', slug: 'chase-mode', name: 'Chase Mode', state: 'seasonal', tierCode: 'M3', prestigeCode: 'P2', metricType: 'rank', metricValue: 10, metricLabel: '+10', iconKey: 'league-momentum', ruleType: 'position_gain_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for gaining 10 places in league standings.', ruleConfig: { metric: 'max_position_gain_single_season', target: 10 } },
  { familyCode: 'L05', badgeType: 'league', slug: 'breakthrough-season', name: 'Breakthrough', state: 'seasonal', tierCode: 'M4', prestigeCode: 'P3', metricType: 'rank', metricValue: 15, metricLabel: '+15', iconKey: 'league-momentum', ruleType: 'position_gain_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for gaining 15 places in league standings.', ruleConfig: { metric: 'max_position_gain_single_season', target: 15 } },
  { familyCode: 'L05', badgeType: 'league', slug: 'comeback-season', name: 'Comeback Season', state: 'seasonal', tierCode: 'M5', prestigeCode: 'P4', metricType: 'boolean', metricValue: true, metricLabel: 'CB', iconKey: 'league-momentum', ruleType: 'manual_admin_award', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for a major recovery from low early standing to final podium contention.', ruleConfig: { metric: 'comeback_season', requires: ['started_outside_top_20', 'final_rank<=3'] } },
  { familyCode: 'L06', badgeType: 'league', slug: 'first-strike', name: 'First Strike', state: 'seasonal', tierCode: 'M1', prestigeCode: 'P3', metricType: 'count', metricValue: 1, metricLabel: '1', iconKey: 'league-round-wins', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for winning 1 round in a season.', ruleConfig: { metric: 'league_round_win_count', target: 1 } },
  { familyCode: 'L06', badgeType: 'league', slug: 'double-strike', name: 'Double Strike', state: 'seasonal', tierCode: 'M2', prestigeCode: 'P3', metricType: 'count', metricValue: 2, metricLabel: '2', iconKey: 'league-round-wins', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for winning 2 rounds in a season.', ruleConfig: { metric: 'league_round_win_count', target: 2 } },
  { familyCode: 'L06', badgeType: 'league', slug: 'round-dominator', name: 'Round Dominator', state: 'seasonal', tierCode: 'M3', prestigeCode: 'P3', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'league-round-wins', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for winning 3 rounds in a season.', ruleConfig: { metric: 'league_round_win_count', target: 3 } },
  { familyCode: 'L06', badgeType: 'league', slug: 'season-crusher', name: 'Season Crusher', state: 'seasonal', tierCode: 'M4', prestigeCode: 'P4', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'league-round-wins', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for winning 5 rounds in a season.', ruleConfig: { metric: 'league_round_win_count', target: 5 } },
  { familyCode: 'L06', badgeType: 'league', slug: 'clean-sweep', name: 'Clean Sweep', state: 'seasonal', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 6, metricLabel: '6', iconKey: 'league-round-wins', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for winning all 6 rounds in a season.', ruleConfig: { metric: 'league_round_win_count', target: 6, seasonRounds: 6 } },
  { familyCode: 'L07', badgeType: 'league', slug: 'league-returner', name: 'League Returner', state: 'permanent', tierCode: 'M1', prestigeCode: 'P1', metricType: 'count', metricValue: 2, metricLabel: '2', iconKey: 'league-seasons', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for completing 2 league seasons.', ruleConfig: { metric: 'league_seasons_completed', target: 2 } },
  { familyCode: 'L07', badgeType: 'league', slug: 'league-loyalist', name: 'League Loyalist', state: 'permanent', tierCode: 'M2', prestigeCode: 'P2', metricType: 'count', metricValue: 3, metricLabel: '3', iconKey: 'league-seasons', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for completing 3 league seasons.', ruleConfig: { metric: 'league_seasons_completed', target: 3 } },
  { familyCode: 'L07', badgeType: 'league', slug: 'league-pillar-seasons', name: 'League Pillar', state: 'permanent', tierCode: 'M3', prestigeCode: 'P3', metricType: 'count', metricValue: 5, metricLabel: '5', iconKey: 'league-seasons', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for completing 5 league seasons.', ruleConfig: { metric: 'league_seasons_completed', target: 5 } },
  { familyCode: 'L07', badgeType: 'league', slug: 'league-icon', name: 'League Icon', state: 'permanent', tierCode: 'M4', prestigeCode: 'P4', metricType: 'count', metricValue: 7, metricLabel: '7', iconKey: 'league-seasons', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for completing 7 league seasons.', ruleConfig: { metric: 'league_seasons_completed', target: 7 } },
  { familyCode: 'L07', badgeType: 'league', slug: 'league-legacy', name: 'League Legacy', state: 'permanent', tierCode: 'M5', prestigeCode: 'P4', metricType: 'count', metricValue: 10, metricLabel: '10', iconKey: 'league-seasons', ruleType: 'count_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H5', description: 'Awarded for completing 10 league seasons.', ruleConfig: { metric: 'league_seasons_completed', target: 10 } },

  // Special / legacy / manual
  { familyCode: 'S01', badgeType: 'special', slug: 'founder-athlete', name: 'Founder Athlete', state: 'legacy', tierCode: 'M4', prestigeCode: 'PL', metricType: 'boolean', metricValue: true, metricLabel: 'FND', iconKey: 'founder', ruleType: 'event_flag_match', hardnessStrategy: 'manual', description: 'Awarded for racing in the platform launch season.', ruleConfig: { metric: 'founder_athlete', eventFlag: 'launch_season' } },
  { familyCode: 'S02', badgeType: 'special', slug: 'founder-team', name: 'Founder Team', state: 'legacy', tierCode: 'M4', prestigeCode: 'PL', metricType: 'boolean', metricValue: true, metricLabel: 'FND', iconKey: 'founder', ruleType: 'event_flag_match', hardnessStrategy: 'manual', description: 'Awarded for teams active in the platform launch season.', ruleConfig: { metric: 'founder_team', eventFlag: 'launch_season' } },
  { familyCode: 'S03', badgeType: 'special', slug: 'opening-season-six-of-six', name: 'Opening Season Six of Six', state: 'legacy', tierCode: 'M5', prestigeCode: 'PL', metricType: 'campaign', metricValue: '6/6', metricLabel: '6/6', iconKey: 'founder', ruleType: 'season_progress_threshold', hardnessStrategy: 'fixed', fixedHardnessCode: 'H4', description: 'Awarded for completing all 6 races in the first league season.', ruleConfig: { metric: 'league_rounds_completed', target: 6, seasonRounds: 6, seasonTag: 'opening-season' } },
  { familyCode: 'S04', badgeType: 'special', slug: 'ever-present', name: 'Ever Present', state: 'dynamic', tierCode: 'M3', prestigeCode: 'P2', metricType: 'campaign', metricValue: true, metricLabel: 'LIVE', iconKey: 'league-participation', ruleType: 'manual_admin_award', hardnessStrategy: 'fixed', fixedHardnessCode: 'H3', description: 'Awarded for having completed every round held so far in the active season.', ruleConfig: { metric: 'completed_every_round_held_so_far', target: true } },
  { familyCode: 'S05', badgeType: 'special', slug: 'fair-play', name: 'Fair Play', state: 'manual', tierCode: 'M3', prestigeCode: 'P3', metricType: 'boolean', metricValue: true, metricLabel: 'FP', iconKey: 'fair-play', ruleType: 'manual_admin_award', hardnessStrategy: 'manual', description: 'Manual award for sportsmanship.', ruleConfig: { metric: 'manual_award', adminKey: 'fair_play' } },
  { familyCode: 'S06', badgeType: 'special', slug: 'organizers-choice', name: 'Organizer’s Choice', state: 'manual', tierCode: 'M3', prestigeCode: 'P3', metricType: 'boolean', metricValue: true, metricLabel: 'OC', iconKey: 'organizer-choice', ruleType: 'manual_admin_award', hardnessStrategy: 'manual', description: 'Manual award selected by organizer.', ruleConfig: { metric: 'manual_award', adminKey: 'organizers_choice' } },
  { familyCode: 'S07', badgeType: 'special', slug: 'volunteer-heart', name: 'Volunteer Heart', state: 'manual', tierCode: 'M3', prestigeCode: 'P3', metricType: 'boolean', metricValue: true, metricLabel: 'VH', iconKey: 'volunteer', ruleType: 'manual_admin_award', hardnessStrategy: 'manual', description: 'Manual badge for volunteer contribution.', ruleConfig: { metric: 'manual_award', adminKey: 'volunteer_heart' } },
  { familyCode: 'S08', badgeType: 'special', slug: 'storm-runner', name: 'Storm Runner', state: 'seasonal', tierCode: 'M3', prestigeCode: 'P3', metricType: 'boolean', metricValue: true, metricLabel: 'STRM', iconKey: 'storm-runner', ruleType: 'event_flag_match', hardnessStrategy: 'direct', description: 'Awarded for finishing an event flagged as severe-condition race.', ruleConfig: { metric: 'storm_runner', eventFlag: 'severe_weather_finish' } },
  { familyCode: 'S09', badgeType: 'special', slug: 'comeback-athlete', name: 'Comeback Athlete', state: 'seasonal', tierCode: 'M3', prestigeCode: 'P2', metricType: 'boolean', metricValue: true, metricLabel: 'CB', iconKey: 'comeback', ruleType: 'manual_admin_award', hardnessStrategy: 'weighted', description: 'Awarded for returning after a long inactivity period.', ruleConfig: { metric: 'comeback_athlete', minInactiveDays: 180 } },
];

export const BADGE_UI_TOKENS = {
  materials: {
    wood: {
      background: 'var(--badge-wood-bg)',
      border: 'var(--badge-wood-border)',
      text: 'var(--badge-wood-text)',
      shadow: 'var(--badge-wood-shadow)',
    },
    bronze: {
      background: 'var(--badge-bronze-bg)',
      border: 'var(--badge-bronze-border)',
      text: 'var(--badge-bronze-text)',
      shadow: 'var(--badge-bronze-shadow)',
    },
    silver: {
      background: 'var(--badge-silver-bg)',
      border: 'var(--badge-silver-border)',
      text: 'var(--badge-silver-text)',
      shadow: 'var(--badge-silver-shadow)',
    },
    gold: {
      background: 'var(--badge-gold-bg)',
      border: 'var(--badge-gold-border)',
      text: 'var(--badge-gold-text)',
      shadow: 'var(--badge-gold-shadow)',
    },
    obsidian: {
      background: 'var(--badge-obsidian-bg)',
      border: 'var(--badge-obsidian-border)',
      text: 'var(--badge-obsidian-text)',
      shadow: 'var(--badge-obsidian-shadow)',
    },
  },
  shapes: {
    'round-medallion': { clipPath: 'circle(50%)' },
    'hex-shield': { clipPath: 'polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0 50%)' },
    'peak-crest': { clipPath: 'polygon(50% 0, 82% 18%, 100% 52%, 78% 100%, 22% 100%, 0 52%, 18% 18%)' },
    'jagged-summit': { clipPath: 'polygon(50% 0, 67% 9%, 83% 0, 100% 26%, 93% 52%, 100% 76%, 80% 100%, 50% 92%, 20% 100%, 0 76%, 7% 52%, 0 26%, 17% 0, 33% 9%)' },
    'relic-star-crest': { clipPath: 'polygon(50% 0, 62% 20%, 84% 10%, 76% 34%, 100% 42%, 80% 58%, 92% 82%, 66% 80%, 58% 100%, 42% 100%, 34% 80%, 8% 82%, 20% 58%, 0 42%, 24% 34%, 16% 10%, 38% 20%)' },
  },
  prestigeAccents: {
    'plain-ring': 'ring-1 ring-black/10',
    'etched-ring': 'ring-2 ring-black/15 after:content-[""] after:absolute after:inset-1 after:border after:border-white/10',
    'laurel-ring': 'ring-2 ring-amber-300/40 shadow-[0_0_18px_rgba(250,204,21,0.25)]',
    'crown-halo': 'ring-2 ring-yellow-300/50 shadow-[0_0_28px_rgba(253,224,71,0.35)]',
    'dated-seal': 'ring-2 ring-orange-300/50 before:content-[attr(data-edition)] before:absolute before:-top-2 before:text-[10px]',
  },
};

export function getBadgeRenderConfig(definition: BadgeDefinitionSeed) {
  const tier = BADGE_VALUE_TIERS.find((item) => item.code === definition.tierCode);
  const prestige = BADGE_PRESTIGE.find((item) => item.code === definition.prestigeCode);
  const hardness = definition.fixedHardnessCode
    ? BADGE_HARDNESS.find((item) => item.code === definition.fixedHardnessCode)
    : null;

  return {
    tier,
    prestige,
    hardness,
    iconKey: definition.iconKey,
    metricLabel: definition.metricLabel,
    renderFormula: {
      baseShape: hardness?.shapeKey ?? 'derived-from-effort',
      material: tier?.material,
      icon: definition.iconKey,
      prestigeAccent: prestige?.accentKey,
      stamp: definition.metricLabel,
    },
  };
}
