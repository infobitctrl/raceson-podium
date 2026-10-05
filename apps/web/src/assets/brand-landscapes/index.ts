import coastCliffDuskAsset from "./supporting/coast-cliff-dusk.webp";
import coastHighRidgeAsset from "./supporting/coast-high-ridge.webp";
import coastalCliffsDayAsset from "./supporting/coastal-cliffs-day.webp";
import coastalHeadlandPathAsset from "./supporting/coastal-headland-path.webp";
import coastalRidgePathAsset from "./supporting/coastal-ridge-path.webp";
import forestMistAsset from "./supporting/forest-mist.webp";
import forestRavineMistAsset from "./supporting/forest-ravine-mist.webp";
import forestRoadMistAsset from "./supporting/forest-road-mist.webp";
import forestSingletrackAsset from "./supporting/forest-singletrack.webp";
import forestSingletrackPortraitAsset from "./supporting/forest-singletrack-portrait.webp";
import forestSunbeamsAsset from "./supporting/forest-sunbeams.webp";
import highRidgePathAsset from "./supporting/high-ridge-path.webp";
import highRidgePathPortraitAsset from "./supporting/high-ridge-path-portrait.webp";
import karstBasinCloudsAsset from "./supporting/karst-basin-clouds.webp";
import karstGrassSunsetAsset from "./supporting/karst-grass-sunset.webp";
import karstMeadowPathAsset from "./supporting/karst-meadow-path.webp";
import karstRoadAsset from "./supporting/karst-road.webp";
import karstValleyPathAsset from "./supporting/karst-valley-path.webp";
import lakeBlueHourAsset from "./supporting/lake-blue-hour.webp";
import lakeForestTrailAsset from "./supporting/lake-forest-trail.webp";
import lakeReflectionAsset from "./supporting/lake-reflection.webp";
import lakeShoreGoldAsset from "./supporting/lake-shore-gold.webp";
import lakesideTrackAsset from "./supporting/lakeside-track.webp";
import mountainRidgeSunnyAsset from "./supporting/mountain-ridge-sunny.webp";
import openKarstAsset from "./supporting/open-karst.webp";
import uplandMeadowAsset from "./supporting/upland-meadow.webp";
import { staticAssetUrl } from "@/lib/static-asset";

export const brandLandscapes = {
  coastCliffDusk: staticAssetUrl(coastCliffDuskAsset),
  coastHighRidge: staticAssetUrl(coastHighRidgeAsset),
  coastalCliffsDay: staticAssetUrl(coastalCliffsDayAsset),
  coastalHeadlandPath: staticAssetUrl(coastalHeadlandPathAsset),
  coastalRidgePath: staticAssetUrl(coastalRidgePathAsset),
  forestMist: staticAssetUrl(forestMistAsset),
  forestRavineMist: staticAssetUrl(forestRavineMistAsset),
  forestRoadMist: staticAssetUrl(forestRoadMistAsset),
  forestSingletrack: staticAssetUrl(forestSingletrackAsset),
  forestSingletrackPortrait: staticAssetUrl(forestSingletrackPortraitAsset),
  forestSunbeams: staticAssetUrl(forestSunbeamsAsset),
  highRidgePath: staticAssetUrl(highRidgePathAsset),
  highRidgePathPortrait: staticAssetUrl(highRidgePathPortraitAsset),
  karstBasinClouds: staticAssetUrl(karstBasinCloudsAsset),
  karstGrassSunset: staticAssetUrl(karstGrassSunsetAsset),
  karstMeadowPath: staticAssetUrl(karstMeadowPathAsset),
  karstRoad: staticAssetUrl(karstRoadAsset),
  karstValleyPath: staticAssetUrl(karstValleyPathAsset),
  lakeBlueHour: staticAssetUrl(lakeBlueHourAsset),
  lakeForestTrail: staticAssetUrl(lakeForestTrailAsset),
  lakeReflection: staticAssetUrl(lakeReflectionAsset),
  lakeShoreGold: staticAssetUrl(lakeShoreGoldAsset),
  lakesideTrack: staticAssetUrl(lakesideTrackAsset),
  mountainRidgeSunny: staticAssetUrl(mountainRidgeSunnyAsset),
  openKarst: staticAssetUrl(openKarstAsset),
  uplandMeadow: staticAssetUrl(uplandMeadowAsset),
} as const;

export const brandLandscapeLibrary = [
  brandLandscapes.coastCliffDusk,
  brandLandscapes.coastHighRidge,
  brandLandscapes.coastalCliffsDay,
  brandLandscapes.coastalHeadlandPath,
  brandLandscapes.coastalRidgePath,
  brandLandscapes.forestMist,
  brandLandscapes.forestRavineMist,
  brandLandscapes.forestRoadMist,
  brandLandscapes.forestSingletrack,
  brandLandscapes.forestSunbeams,
  brandLandscapes.highRidgePath,
  brandLandscapes.karstBasinClouds,
  brandLandscapes.karstGrassSunset,
  brandLandscapes.karstMeadowPath,
  brandLandscapes.karstRoad,
  brandLandscapes.karstValleyPath,
  brandLandscapes.lakeBlueHour,
  brandLandscapes.lakeForestTrail,
  brandLandscapes.lakeReflection,
  brandLandscapes.lakeShoreGold,
  brandLandscapes.lakesideTrack,
  brandLandscapes.mountainRidgeSunny,
  brandLandscapes.openKarst,
  brandLandscapes.uplandMeadow,
] as const;

export const brandLandscapePools = {
  events: [
    brandLandscapes.highRidgePath,
    brandLandscapes.coastalRidgePath,
    brandLandscapes.forestSingletrack,
    brandLandscapes.karstValleyPath,
    brandLandscapes.lakesideTrack,
  ],
  leagues: [
    brandLandscapes.mountainRidgeSunny,
    brandLandscapes.lakeReflection,
    brandLandscapes.coastHighRidge,
    brandLandscapes.uplandMeadow,
    brandLandscapes.forestSunbeams,
  ],
  clubs: [
    brandLandscapes.coastalCliffsDay,
    brandLandscapes.forestMist,
    brandLandscapes.lakeShoreGold,
    brandLandscapes.karstMeadowPath,
    brandLandscapes.lakeForestTrail,
  ],
  results: [
    brandLandscapes.openKarst,
    brandLandscapes.karstRoad,
    brandLandscapes.karstBasinClouds,
    brandLandscapes.lakeBlueHour,
    brandLandscapes.highRidgePath,
  ],
} as const;

export function pickBrandLandscape(
  seed: string | number,
  pool: readonly string[] = brandLandscapeLibrary,
) {
  const normalizedSeed = String(seed);
  let hash = 2166136261;

  for (let index = 0; index < normalizedSeed.length; index += 1) {
    hash ^= normalizedSeed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return pool[(hash >>> 0) % pool.length];
}

export const homepagePromotionalLandscapes = {
  event: brandLandscapes.coastalHeadlandPath,
  league: brandLandscapes.karstValleyPath,
  club: brandLandscapes.forestRavineMist,
} as const;

export const homepageRoleLandscapes = {
  athlete: brandLandscapes.highRidgePathPortrait,
  organizer: brandLandscapes.forestSingletrackPortrait,
} as const;
