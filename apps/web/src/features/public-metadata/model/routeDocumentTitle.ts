import { matchPath } from "react-router-dom";
import type { AppLocale } from "@/shared/i18n/locales";
import { documentTitleKey } from "@/shared/navigation/documentTitle";
import { localizedStaticDefinition, STATIC_PAGE_DEFINITIONS } from "./publicPageDefinitions";

type RouteTitle = { title: string; key: string };
type Labels = readonly [en: string, hr: string];
const labels = (value: Labels, locale: AppLocale) => value[locale === "hr" ? 1 : 0];

const workspaceTitles: Record<string, Labels> = {
  "/auth": ["Sign in or create an account", "Prijava ili izrada računa"],
  "/auth/reset": ["Reset password", "Promjena lozinke"],
  "/registration": ["Race registration", "Prijava na utrku"],
  "/legal": ["Privacy and legal", "Privatnost i pravne informacije"],
  "/clubs/create": ["Create a club", "Osnuj klub"],
  "/athlete/dashboard": ["Athlete dashboard", "Pregled natjecatelja"],
  "/athlete/dashboardfurther": ["Athlete dashboard", "Pregled natjecatelja"],
  "/athlete/my-races": ["My races", "Moje utrke"],
  "/athlete/results": ["My results", "Moji rezultati"],
  "/athlete/clubs": ["My clubs", "Moji klubovi"],
  "/athlete/badges": ["My badges", "Moje značke"],
  "/athlete/favorites": ["Favorites", "Favoriti"],
  "/athlete/statistics": ["My statistics", "Moja statistika"],
  "/athlete/gpx-upload": ["Upload a GPX route", "Učitaj GPX rutu"],
  "/notifications": ["Notifications", "Obavijesti"],
  "/athlete/account": ["My account", "Moj račun"],
  "/athlete/support": ["Athlete support", "Podrška natjecateljima"],
  "/organizer/dashboard": ["Organizer dashboard", "Pregled organizatora"],
  "/organizer/events": ["Organizer races", "Utrke organizatora"],
  "/organizer/registrations": ["Registrations", "Prijave"],
  "/organizer/registrations/overview": ["Registration overview", "Pregled prijava"],
  "/organizer/registrations/finance": ["Race finances", "Financije utrke"],
  "/organizer/registrations/desk": ["Registration desk", "Prijavni stol"],
  "/organizer/registrations/results": ["Race results", "Rezultati utrka"],
  "/organizer/leagues": ["Organizer leagues", "Lige organizatora"],
  "/organizer/race-operations": ["Race day", "Dan utrke"],
  "/organizer/timing-results": ["Timing and results", "Mjerenje vremena i rezultati"],
  "/organizer/testing": ["Practice workspace", "Prostor za testiranje"],
  "/organizer/testing/results": ["Practice results", "Rezultati testiranja"],
  "/organizer/team": ["Organizer team", "Tim organizatora"],
  "/organizer/account": ["Organizer account", "Račun organizatora"],
  "/organizer/settings/payments": ["Payment settings", "Postavke plaćanja"],
  "/organizer/site-admins": ["Platform administration", "Administracija platforme"],
  "/organizer/statistics": ["Platform statistics", "Statistika platforme"],
  "/organizer/requests": ["Platform requests", "Zahtjevi platforme"],
  "/organizer/track-attempts": ["Route attempts", "Pokušaji na rutama"],
  "/organizer/support": ["Organizer support", "Podrška organizatorima"],
  "/organizer/create-track": ["Create a route", "Izradi rutu"],
};

const entityRoutes: Array<{ pattern: string; kind: string; ids: string[]; title: Labels }> = [
  { pattern: "/events/:eventId/results/:registrationId", kind: "result", ids: ["eventId", "registrationId"], title: ["Runner result", "Rezultat natjecatelja"] },
  { pattern: "/live/:eventSlug/:raceSlug", kind: "live", ids: ["eventSlug", "raceSlug"], title: ["Live on Route", "Uživo na ruti"] },
  { pattern: "/leagues/:leagueId/events/:eventId/tracks/:trackId", kind: "track", ids: ["trackId"], title: ["Race route", "Ruta utrke"] },
  { pattern: "/events/:eventId/tracks/:trackId", kind: "track", ids: ["trackId"], title: ["Race route", "Ruta utrke"] },
  { pattern: "/leagues/:leagueId/events/:eventId", kind: "event", ids: ["eventId"], title: ["Race", "Utrka"] },
  { pattern: "/events/:id", kind: "event", ids: ["id"], title: ["Race", "Utrka"] },
  { pattern: "/tracks/:id", kind: "track", ids: ["id"], title: ["Race route", "Ruta utrke"] },
  { pattern: "/athletes/:id", kind: "athlete", ids: ["id"], title: ["Athlete profile", "Profil natjecatelja"] },
  { pattern: "/clubs/:id", kind: "club", ids: ["id"], title: ["Club profile", "Profil kluba"] },
  { pattern: "/leagues/:id", kind: "league", ids: ["id"], title: ["Race league", "Sportska liga"] },
];

const workspacePatterns: Array<[string, Labels]> = [
  ["/clubs/:id/edit", ["Edit club", "Uredi klub"]],
  ["/athlete/clubs/:clubSlug/club", ["Club management", "Upravljanje klubom"]],
  ["/organizer/events/:eventId/race-day/results", ["Timing and results", "Mjerenje vremena i rezultati"]],
  ["/organizer/events/:eventId/results", ["Timing and results", "Mjerenje vremena i rezultati"]],
  ["/organizer/events/:eventId/race-day", ["Race day", "Dan utrke"]],
  ["/organizer/events/:eventId", ["Manage race", "Upravljanje utrkom"]],
  ["/organizer/leagues/:seasonId", ["Manage league", "Upravljanje ligom"]],
];

function decoded(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function resolveRouteDocumentTitle(pathname: string, locale: AppLocale): RouteTitle {
  const path = pathname.replace(/^\/(?:hr|en)(?=\/|$)/, "").replace(/\/+$/, "") || "/";
  const staticPath = path.slice(1);
  if (Object.hasOwn(STATIC_PAGE_DEFINITIONS, staticPath)) {
    return { key: path, title: localizedStaticDefinition(staticPath, locale).title };
  }
  if (Object.hasOwn(workspaceTitles, path)) return { key: path, title: labels(workspaceTitles[path], locale) };
  for (const route of entityRoutes) {
    const match = matchPath(route.pattern, path);
    if (match) return {
      key: documentTitleKey(route.kind, ...route.ids.map(id => decoded(match.params[id] ?? ""))),
      title: labels(route.title, locale),
    };
  }
  for (const [pattern, title] of workspacePatterns) {
    if (matchPath(pattern, path)) return { key: path, title: labels(title, locale) };
  }
  return { key: path, title: labels(["Page not found", "Stranica nije pronađena"], locale) };
}
