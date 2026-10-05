import type { AppLocale } from "@/shared/i18n/locales";
import { HOME_SEARCH_TITLE } from "./publicSocialMetadata";

export const STATIC_PAGE_DEFINITIONS: Record<string, { title: string; description: string }> = {
  "": {
    title: HOME_SEARCH_TITLE,
    description: "Find your next race, register and follow official results. Trail running, cycling, swimming, triathlon, clubs and leagues in Croatia and the region.",
  },
  events: {
    title: "Endurance Races in Croatia & the Balkans",
    description:
      "Find trail running, road running, cycling, swimming, duathlon, triathlon, and aquathlon races, registration details, routes, and results.",
  },
  tracks: {
    title: "Race Routes, Maps, Elevation & GPX Files",
    description:
      "Explore endurance race routes with maps, distance, elevation, checkpoints, terrain details, and GPX downloads across Croatia and the Balkans.",
  },
  athletes: {
    title: "Athletes, Race History & Performance",
    description:
      "Find public athlete profiles with official race history, finishes, personal performance, club participation, and league standings on RacesOn.",
  },
  clubs: {
    title: "Running, Trail & Endurance Clubs",
    description:
      "Discover running, trail, cycling, triathlon, and endurance clubs, their athletes, race history, league participation, and public activities.",
  },
  leagues: {
    title: "Race Leagues, Calendars & Standings",
    description:
      "Follow endurance league calendars, rounds, scoring rules, official results, athlete rankings, and club standings across the region.",
  },
  results: {
    title: "Official Race Results",
    description:
      "Browse official endurance race results, finish times, classifications, race history, and verified organizer publications on RacesOn.",
  },
  live: {
    title: "Live on Route",
    description:
      "Follow recorded checkpoint passes, live standings, and race progress from active RacesOn races without estimated between-point GPS positions.",
  },
  rankings: {
    title: "Endurance Athlete Rankings",
    description:
      "Explore public endurance athlete rankings based on official published race results across RacesOn races and seasons.",
  },
  "stats/athletes": {
    title: "Athlete Statistics",
    description:
      "Explore platform-wide athlete participation, finishes, distance, elevation, and performance statistics from official RacesOn results.",
  },
  "stats/events": {
    title: "Race Statistics",
    description:
      "Explore race participation, categories, locations, distances, and published-result statistics across RacesOn.",
  },
  "stats/clubs": {
    title: "Club Statistics",
    description:
      "Compare club participation, finishes, distance, elevation, podiums, and wins from official RacesOn race results.",
  },
  "stats/leagues": {
    title: "League Statistics",
    description:
      "Explore league seasons, rounds, participation, standings, and scoring statistics across RacesOn.",
  },
  "for-organizers": {
    title: "Race Management Software for Organizers",
    description:
      "Publish races, open registration, coordinate race day, manage timing, and verify official results from one connected organizer workspace.",
  },
  about: {
    title: "About RacesOn",
    description:
      "RacesOn is the Croatia-first endurance platform connecting organizers, athletes, races, registration, race-day operations, official results, clubs, and leagues.",
  },
  brand: {
    title: "RacesOn Brand",
    description:
      "Meet RacesOn: the regional endurance platform built around the signal of every start line, route, checkpoint, athlete, and official result.",
  },
  contact: {
    title: "Contact & support",
    description: "Contact the RacesOn team at info@raceson.com for account help, platform support, organizer enquiries and partnerships.",
  },
  faq: {
    title: "RacesOn Frequently Asked Questions",
    description:
      "Answers for athletes, organizers, clubs, and partners about RacesOn accounts, races, registration, race-day operations, results, and the SiTRAIL transition.",
  },
};

const LOCALIZED_STATIC_PAGE_DEFINITIONS: Partial<Record<
  string,
  Record<AppLocale, { title: string; description: string }>
>> = {
  events: {
    en: STATIC_PAGE_DEFINITIONS.events,
    hr: {
      title: "Utrke izdržljivosti u Hrvatskoj i regiji",
      description:
        "Pronađi trail, cestovne, biciklističke, plivačke, duatlonske, triatlonske i akvatlonske utrke. Pogledaj rute, prijavi se i prati rezultate.",
    },
  },
  live: {
    en: STATIC_PAGE_DEFINITIONS.live,
    hr: {
      title: "Uživo na ruti",
      description:
        "Prati zabilježene prolaze i poredak na kontrolnim točkama. Prikaz ne procjenjuje GPS položaj natjecatelja između točaka.",
    },
  },
  "": { en: STATIC_PAGE_DEFINITIONS[""], hr: {
    title: "RacesOn | Utrke, prijave i rezultati",
    description: "Pronađi utrku, prijavi se i prati službene rezultate. Trail trčanje, biciklizam, plivanje, triatlon, klubovi i lige u Hrvatskoj i regiji.",
  } },
  tracks: { en: STATIC_PAGE_DEFINITIONS.tracks, hr: {
    title: "Rute utrka, karte i GPX datoteke",
    description: "Istraži rute, duljinu, uspon, kontrolne točke i podlogu. Pogledaj kartu i preuzmi GPX datoteku za pripremu.",
  } },
  athletes: { en: STATIC_PAGE_DEFINITIONS.athletes, hr: {
    title: "Natjecatelji i njihovi rezultati",
    description: "Pronađi natjecatelja i pogledaj njegove javne rezultate, završene utrke, klub i poredak u ligi.",
  } },
  clubs: { en: STATIC_PAGE_DEFINITIONS.clubs, hr: {
    title: "Sportski klubovi i njihovi natjecatelji",
    description: "Upoznaj trkačke, trail, biciklističke i triatlonske klubove. Pogledaj članove, rezultate, lige i javne aktivnosti.",
  } },
  leagues: { en: STATIC_PAGE_DEFINITIONS.leagues, hr: {
    title: "Sportske lige, kalendari i poredak",
    description: "Pronađi ligu, pogledaj raspored kola i pravila bodovanja te prati rezultate i poredak natjecatelja i klubova.",
  } },
  results: { en: STATIC_PAGE_DEFINITIONS.results, hr: {
    title: "Službeni rezultati utrka",
    description: "Pronađi službene rezultate, vremena i plasmane po kategorijama iz utrka objavljenih na RacesOn-u.",
  } },
  rankings: { en: STATIC_PAGE_DEFINITIONS.rankings, hr: {
    title: "Poredak natjecatelja",
    description: "Pogledaj poredak natjecatelja prema službenim rezultatima utrka i sezona na RacesOn-u.",
  } },
  "stats/athletes": { en: STATIC_PAGE_DEFINITIONS["stats/athletes"], hr: {
    title: "Statistika natjecatelja",
    description: "Završene utrke, kilometri, uspon i nastupi natjecatelja prema službenim rezultatima na RacesOn-u.",
  } },
  "stats/events": { en: STATIC_PAGE_DEFINITIONS["stats/events"], hr: {
    title: "Statistika utrka",
    description: "Pogledaj broj sudionika, vrste utrka, lokacije, duljine i statistiku objavljenih rezultata.",
  } },
  "stats/clubs": { en: STATIC_PAGE_DEFINITIONS["stats/clubs"], hr: {
    title: "Statistika klubova",
    description: "Usporedi nastupe, završene utrke, kilometre, uspon, postolja i pobjede klubova prema službenim rezultatima.",
  } },
  "stats/leagues": { en: STATIC_PAGE_DEFINITIONS["stats/leagues"], hr: {
    title: "Statistika liga",
    description: "Pregledaj sezone, kola, sudjelovanje, bodovanje i poredak liga na RacesOn-u.",
  } },
  "for-organizers": { en: STATIC_PAGE_DEFINITIONS["for-organizers"], hr: {
    title: "Organiziraj utrku uz RacesOn",
    description: "Pripremi utrku, otvori prijave, poveži ekipu, bilježi prolaze i objavi provjerene rezultate na jednom mjestu.",
  } },
  about: { en: STATIC_PAGE_DEFINITIONS.about, hr: {
    title: "O RacesOn-u",
    description: "RacesOn povezuje sportaše, organizatore, klubove i lige. Saznaj kako je od lokalnih utrka nastala zajednica za Hrvatsku i regiju.",
  } },
  brand: { en: STATIC_PAGE_DEFINITIONS.brand, hr: {
    title: "RacesOn: vizualni identitet i način pisanja",
    description: "Upoznaj RacesOn logotip, boje i način pisanja: izravno, konkretno i ljudski.",
  } },
  contact: { en: STATIC_PAGE_DEFINITIONS.contact, hr: {
    title: "Kontakt i podrška",
    description: "Kontaktiraj RacesOn tim na info@raceson.com za pomoć s računom, podršku na platformi, pitanja organizatora i suradnje.",
  } },
  faq: { en: STATIC_PAGE_DEFINITIONS.faq, hr: {
    title: "Česta pitanja o RacesOn-u",
    description: "Odgovori o RacesOn računima, prijelazu sa SiTRAIL-a, poveznicama, podršci i pravilima utrka.",
  } },
};

export function localizedStaticDefinition(path: string, locale: AppLocale) {
  return LOCALIZED_STATIC_PAGE_DEFINITIONS[path]?.[locale] ?? STATIC_PAGE_DEFINITIONS[path];
}
