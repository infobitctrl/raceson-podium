import { isSibenikTrailLeagueRace } from "./homepageFeaturedSet";

type HomepageRaceCard = {
  id?: string;
  name?: string;
  title?: string;
  leagueMemberships?: Array<{
    leagueName?: string | null;
    leagueSlug?: string | null;
  }>;
  date: string;
  status: "open" | "closed" | "live" | "upcoming" | "finished" | "sold_out";
};

const closedRaceStatuses = new Set<HomepageRaceCard["status"]>(["closed", "finished"]);
const featuredRaceSlug = "zlarin-trail-2026";

function compareRaceDatesAscending(left: HomepageRaceCard, right: HomepageRaceCard) {
  return Date.parse(left.date) - Date.parse(right.date);
}

function isFeaturedRace(event: HomepageRaceCard) {
  if (event.id === featuredRaceSlug) return true;
  return (event.title ?? event.name ?? "").toLocaleLowerCase("en-US").includes("zlarin");
}

export function selectHomepageRaceCards<T extends HomepageRaceCard>(events: T[], limit = 3) {
  const upcomingEvents = events
    .filter((event) => !closedRaceStatuses.has(event.status))
    .sort((left, right) => {
      const featuredOrder = Number(isFeaturedRace(right)) - Number(isFeaturedRace(left));
      return featuredOrder || compareRaceDatesAscending(left, right);
    })
    .slice(0, limit);
  const remainingSlots = limit - upcomingEvents.length;

  if (remainingSlots === 0) return upcomingEvents;

  const finishedEvents = events
    .filter((event) => closedRaceStatuses.has(event.status))
    .sort((left, right) => {
      const leagueOrder = Number(isSibenikTrailLeagueRace(right))
        - Number(isSibenikTrailLeagueRace(left));
      return leagueOrder || Date.parse(right.date) - Date.parse(left.date);
    })
    .slice(0, remainingSlots);

  return [...upcomingEvents, ...finishedEvents];
}

function getRaceDistanceKm(distance: string) {
  const match = distance.replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : 0;
}

export function selectLongestRaceCategory<T extends { distance: string }>(categories: T[]) {
  return categories.reduce<T | undefined>((longest, category) => {
    if (!longest) return category;
    return getRaceDistanceKm(category.distance) > getRaceDistanceKm(longest.distance) ? category : longest;
  }, undefined);
}
