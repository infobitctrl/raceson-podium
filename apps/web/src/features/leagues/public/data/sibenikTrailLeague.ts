import {
  isSibenikTrailLeagueIdentity,
  SIBENIK_TRAIL_LEAGUE_ENGLISH_NAME,
  SIBENIK_TRAIL_LEAGUE_SLUG,
  SIBENIK_TRAIL_LEAGUE_SLUG_ALIASES,
  SIBENIK_TRAIL_LEAGUE_SOURCE_SLUG,
} from "@/features/leagues/model/sibenikTrailLeagueIdentity";

export {
  SIBENIK_TRAIL_LEAGUE_ENGLISH_NAME,
  SIBENIK_TRAIL_LEAGUE_LOCAL_NAME,
  SIBENIK_TRAIL_LEAGUE_SLUG,
  SIBENIK_TRAIL_LEAGUE_SOURCE_SLUG,
} from "@/features/leagues/model/sibenikTrailLeagueIdentity";

export const SIBENIK_TRAIL_LEAGUE_NAME = SIBENIK_TRAIL_LEAGUE_ENGLISH_NAME;

export const SIBENIK_TRAIL_LEAGUE_ALIASES = SIBENIK_TRAIL_LEAGUE_SLUG_ALIASES;

export const SIBENIK_TRAIL_LEAGUE_BRIEF =
  "Šibenik Trail League is a seven-round championship across Šibenik’s coast, hinterland, canyons, and rocky climbs. The best five results count toward the season standings.";

export const SIBENIK_TRAIL_LEAGUE_DESCRIPTION = [
  `Season Brief: ${SIBENIK_TRAIL_LEAGUE_BRIEF}`,
  "League Image: /league-media/sibenska-trail-liga/window-valley.jpeg",
  "Round Plan: 7 planned rounds · League race categories",
  "Scoring: Custom points table · Winner 50 points · 100 expected finishers · Every later official finisher earns 5 points · Best 5 results count · Minimum 1 rounds to classify · Tie-break Best finish · Club mode Combined races · best 3",
  "Standings: Overall + age-group + club views",
  "Operations: Publish after every round · Protest window 72 hours",
  "Closeout: Awards + sponsor recap + archived season report",
].join("\n");

export const SIBENIK_TRAIL_LEAGUE_ORGANIZER_RULES = [
  "ŠIBENSKA TRAIL LIGA — PRAVILA SEZONE / ŠIBENIK TRAIL LEAGUE — SEASON RULES",
  "",
  "1. Primjena / Scope",
  "Ova pravila uređuju ligašku prihvatljivost, bodovanje, poredak i prigovore. Uvjeti prijave, obvezna oprema, staza, vremenska ograničenja, povrati i sigurnosne upute objavljuju se za svaki događaj zasebno. Na dan utrke sigurnosne upute organizatora događaja imaju prednost, ali ne mijenjaju prešutno ligaško bodovanje.",
  "These rules govern league eligibility, scoring, standings, and protests. Entry terms, mandatory equipment, course, cut-offs, refunds, and safety instructions are published separately for each event. Event-organizer safety directions prevail on race day but do not silently change league scoring.",
  "",
  "2. Prihvatljivost i rezultat / Eligibility and result",
  "U poredak ulazi sportaš s valjanom prijavom i objavljenim službenim ili ispravljenim rezultatom u mapiranoj utrci. DNS, DNF, diskvalifikacija i poništen rezultat ne dobivaju bodove za plasman. Kategorija, dob i klupska pripadnost utvrđuju se prema objavljenoj konfiguraciji sezone i zapisu rezultata.",
  "A valid entry and an official or corrected result in a mapped race are required for the standings. DNS, DNF, disqualification, and void results receive no placing points. Category, age, and club attribution follow the published season configuration and result record.",
  "",
  "3. Bodovanje / Scoring",
  "Mjerodavna je strukturirana tablica bodova prikazana ispod ovih pravila. Sezona ima sedam planiranih kola, a najboljih pet rezultata ulazi u pojedinačni zbroj. Bodovi za kasniji službeni završetak, najmanji broj nastupa, način rješavanja izjednačenja i klupski zbroj primjenjuju se točno kako su objavljeni u tablicama pravila platforme.",
  "The structured points table displayed below is authoritative. The season has seven planned rounds and the best five results count toward an individual total. Later-finisher points, minimum appearances, tie-break method, and club aggregation apply exactly as published in the platform rule tables.",
  "",
  "4. Objave, ispravci i prigovori / Publication, corrections, and protests",
  "Liga se ažurira nakon službene objave rezultata događaja. Ispravljeni rezultat zamjenjuje prethodni rezultat u sljedećem ligaškom izračunu uz vidljiv trag ispravka. Prigovor se podnosi organizatoru u roku od 72 sata od relevantne objave, osim ako događaj objavi kraći sigurnosni rok. Organizator mora obrazložiti odluku i ispraviti zahvaćene poretke.",
  "The league updates after an event publishes official results. A corrected result replaces the earlier result in the next league calculation with correction history preserved. Protests must reach the organizer within 72 hours of the relevant publication unless an event publishes a shorter safety deadline. The organizer must explain the decision and correct affected standings.",
  "",
  "5. Pošteno natjecanje i izmjene / Fair competition and changes",
  "Zabranjeni su lažni identiteti, zamjena startnog broja, skraćivanje rute, propuštanje obvezne kontrole, manipulacija vremenom ili GPS dokazom te ometanje drugih. Bitne promjene vrijede unaprijed i moraju biti objavljene prijavljenim sudionicima. Retroaktivna promjena dopuštena je samo radi ispravka pogreške, sigurnosti ili primjene mjerodavnog pravila, uz obrazloženje i ponovni izračun.",
  "False identity, bib swapping, route cutting, missed mandatory checkpoints, manipulation of timing or GPS evidence, and interference with others are prohibited. Material changes apply prospectively and must be notified to registered participants. A retroactive change is limited to correcting an error, protecting safety, or applying an existing rule, with reasons and recalculation.",
  "",
  "6. Privatnost / Privacy",
  "Javni ligaški zapis ograničen je na podatke potrebne za rezultate i poredak, primjerice ime, klub, kategoriju, vrijeme, plasman i bodove. Kontakt za hitne slučajeve, zdravstveni podaci, podaci o plaćanju i privatni GPS zapisi nisu dio javnog poretka. Za prava na pristup, ispravak, brisanje, ograničenje ili prigovor vrijedi obavijest Pravila, privatnost i pravne informacije te obavijest odgovornog organizatora.",
  "The public league record is limited to data needed for results and standings, such as name, club, category, time, place, and points. Emergency contact, health, payment, and private GPS data are not part of public standings. Access, correction, erasure, restriction, and objection rights are explained in the Rules, privacy & legal center and the responsible organizer's notice.",
].join("\n");

export const SIBENIK_TRAIL_LEAGUE_MEDIA = {
  hero: "/league-media/sibenska-trail-liga/window-valley.jpeg",
  logo: "/league-media/sibenska-trail-liga/si-trail-wordmark.png",
  headerLogo: "/league-media/sibenska-trail-liga/si-trail-wordmark-transparent.png",
  rounds: {
    "vrpolje-trail-2026-2026": "/league-media/sibenska-trail-liga/vrpolje.jpeg",
    "torak-trail-2026": "/league-media/sibenska-trail-liga/window-valley.jpeg",
    "trtarski-krug-2026": "/league-media/sibenska-trail-liga/trtar.png",
    "raslina-trail-2026": "/league-media/sibenska-trail-liga/raslina.jpeg",
  } as Record<string, string>,
} as const;

export const SIBENIK_TRAIL_LEAGUE_DEFAULT_ROUNDS = [
  {
    roundNumber: 1,
    eventSlug: "vrpolje-trail-2026-2026",
    name: "Vrpolje Trail 2026",
    dateIso: "2026-03-15",
    location: "Vrpolje, Šibenik",
    distance: "5.4–14.9 km",
    elevation: "201–640m D+",
  },
  {
    roundNumber: 2,
    eventSlug: "torak-trail-2026",
    name: "Torak Trail 2026",
    dateIso: "2026-04-04",
    location: "Torak, Šibenik",
    distance: "4.9–12.6 km",
    elevation: "215–447m D+",
  },
  {
    roundNumber: 3,
    eventSlug: "trtarski-krug-2026",
    name: "Trtarski krug 2026",
    dateIso: "2026-05-24",
    location: "Trtar, Šibenik",
    distance: "5.3–15.0 km",
    elevation: "174–654m D+",
  },
  {
    roundNumber: 4,
    eventSlug: "raslina-trail-2026",
    name: "Raslina Trail 2026",
    dateIso: "2026-05-30",
    location: "Raslina, Šibenik",
    distance: "5.5–10.8 km",
    elevation: "144–341m D+",
  },
] as const;

export function isSibenikTrailLeague(value: string | null | undefined) {
  return isSibenikTrailLeagueIdentity(value);
}

export function getSibenikTrailLeagueLookupSlugs(value: string) {
  return isSibenikTrailLeague(value)
    ? [...SIBENIK_TRAIL_LEAGUE_ALIASES]
    : [value];
}

export function getSibenikTrailLeagueRoundImage(
  eventSlug: string | null | undefined,
  currentImage?: string | null,
) {
  const legacyImage = eventSlug ? SIBENIK_TRAIL_LEAGUE_MEDIA.rounds[eventSlug] : null;
  return legacyImage ?? currentImage ?? null;
}
