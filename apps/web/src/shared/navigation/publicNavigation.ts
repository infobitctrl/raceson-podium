import type { TranslationKey } from "@/shared/i18n/messages";

export type PublicNavigationDestination = {
  id: "home" | "events" | "tracks" | "leagues" | "results" | "rankings" | "stats" | "clubs" | "athletes";
  labelKey: TranslationKey;
  path: string;
};

export const publicPrimaryNavigationItems = [
  { id: "home", labelKey: "common.home", path: "/" },
  { id: "events", labelKey: "nav.events", path: "/events" },
  { id: "tracks", labelKey: "nav.tracks", path: "/tracks" },
  { id: "leagues", labelKey: "common.leagues", path: "/leagues" },
  { id: "results", labelKey: "common.results", path: "/results" },
  { id: "rankings", labelKey: "nav.rankings", path: "/rankings" },
  { id: "stats", labelKey: "common.stats", path: "/stats" },
  { id: "clubs", labelKey: "nav.clubs", path: "/clubs" },
  { id: "athletes", labelKey: "nav.athletes", path: "/athletes" },
] satisfies PublicNavigationDestination[];

export const publicMobilePrimaryNavigationItems = publicPrimaryNavigationItems.filter((item) => (
  item.id === "home"
  || item.id === "events"
  || item.id === "leagues"
  || item.id === "results"
  || item.id === "athletes"
));

export const publicMobileMoreNavigationItems = publicPrimaryNavigationItems.filter((item) => (
  item.id === "tracks"
  || item.id === "stats"
  || item.id === "clubs"
));
