import { translateApplicationCopyToCroatian } from "@/shared/i18n/documentLocalization";
import type { AppLocale } from "@/shared/i18n/locales";

function replaceMatch(
  value: string,
  pattern: RegExp,
  replacement: (...parts: string[]) => string,
) {
  const match = value.match(pattern);
  return match ? replacement(...match.slice(1)) : null;
}

/**
 * Localizes organizer-league messages that contain organizer-authored names or
 * calculated counts. Those values must remain unchanged while the application
 * sentence around them is translated.
 */
export function localizeOrganizerLeagueText(value: string, locale: AppLocale) {
  if (locale !== "hr") return value;

  const exact = translateApplicationCopyToCroatian(value);
  if (exact !== value) return exact;

  const rules: Array<() => string | null> = [
    () => replaceMatch(value, /^(Female|Male|Any sex) · Any age$/, (gender) => `${gender === "Female" ? "Žene" : gender === "Male" ? "Muškarci" : "Svi spolovi"} · bilo koja dob`),
    () => replaceMatch(value, /^(Female|Male|Any sex) · ages (.+)–(.+)$/, (gender, minimum, maximum) => `${gender === "Female" ? "Žene" : gender === "Male" ? "Muškarci" : "Svi spolovi"} · dob ${minimum}–${maximum}`),
    () => replaceMatch(value, /^(Female|Male|Any sex) · age (.+)\+$/, (gender, minimum) => `${gender === "Female" ? "Žene" : gender === "Male" ? "Muškarci" : "Svi spolovi"} · dob ${minimum}+`),
    () => replaceMatch(value, /^(Female|Male|Any sex) · age through (.+)$/, (gender, maximum) => `${gender === "Female" ? "Žene" : gender === "Male" ? "Muškarci" : "Svi spolovi"} · dob do ${maximum}`),
    () => replaceMatch(value, /^(.+): every scoring group needs a name\.$/, (competition) => `${competition}: svaka bodovna skupina mora imati naziv.`),
    () => replaceMatch(value, /^(.+): scoring group names must be unique\.$/, (competition) => `${competition}: nazivi bodovnih skupina moraju biti jedinstveni.`),
    () => replaceMatch(value, /^(.+) · (.+): enter an age limit or leave both age fields blank for any age\.$/, (competition, group) => `${competition} · ${group}: unesite dobnu granicu ili ostavite oba dobna polja prazna za bilo koju dob.`),
    () => replaceMatch(value, /^(.+) · (.+): age from must be between 0 and 120\.$/, (competition, group) => `${competition} · ${group}: početna dob mora biti između 0 i 120.`),
    () => replaceMatch(value, /^(.+) · (.+): age through must be between 0 and 120\.$/, (competition, group) => `${competition} · ${group}: završna dob mora biti između 0 i 120.`),
    () => replaceMatch(value, /^(.+) · (.+): age from cannot exceed age through\.$/, (competition, group) => `${competition} · ${group}: početna dob ne može biti veća od završne dobi.`),
    () => replaceMatch(value, /^(.+) · (.+) selects the same runners as (.+)\. Change Participants or Age from\/through\.$/, (competition, group, conflict) => `${competition} · ${group} obuhvaća iste natjecatelje kao ${conflict}. Promijenite sudionike ili dob od/do.`),
    () => replaceMatch(value, /^(.+): add at least one graded points value\.$/, (competition) => `${competition}: dodajte najmanje jednu vrijednost stupnjevanih bodova.`),
    () => replaceMatch(value, /^(.+): points must be zero or greater\.$/, (competition) => `${competition}: bodovi moraju biti nula ili više.`),
    () => replaceMatch(value, /^(.+): participation points cannot exceed the last graded score\.$/, (competition) => `${competition}: bodovi za sudjelovanje ne mogu biti veći od posljednjeg stupnjevanog rezultata.`),
    () => replaceMatch(value, /^(.+): winner points must be between 2 and 10,000\.$/, (competition) => `${competition}: bodovi pobjednika moraju biti između 2 i 10.000.`),
    () => replaceMatch(value, /^(.+): expected finishers must be between 2 and 500\.$/, (competition) => `${competition}: očekivani broj finišera mora biti između 2 i 500.`),
    () => replaceMatch(value, /^(.+): finisher minimum must be at least 1 and lower than winner points\.$/, (competition) => `${competition}: minimum za finišera mora biti najmanje 1 i manji od bodova pobjednika.`),
    () => replaceMatch(value, /^(.+): counted results must be between 1 and (\d+)\.$/, (competition, rounds) => `${competition}: broj rezultata koji se računaju mora biti između 1 i ${rounds}.`),
    () => replaceMatch(value, /^(.+): minimum finishes must be between 1 and (\d+)\.$/, (competition, rounds) => `${competition}: minimalni broj završetaka mora biti između 1 i ${rounds}.`),
    () => replaceMatch(value, /^(.+) (?:is|are) not included in this league's sports\.$/, (sports) => `${sports} nisu uključeni u sportove ove lige.`),
    () => replaceMatch(value, /^This league has (\d+) race (?:category|categories), but the event has (\d+) competitive (?:race|races)\. You can still add the round, but (\d+) league (?:category|categories) will not score in it\.$/, (categories, races, unmapped) => `Liga ima ${categories} kategorija utrka, a utrka ${races} natjecateljskih utrka. Kolo ipak možete dodati, ali ${unmapped} kategorija lige neće se bodovati.`),
    () => replaceMatch(value, /^This league has (\d+) route (?:category|categories), but the race has (\d+) competitive (?:route|routes)\. You can still add the round, but (\d+) (?:route|routes) will not count toward league standings\.$/, (categories, routes, unused) => `Liga ima ${categories} kategorija ruta, a utrka ${routes} natjecateljskih ruta. Kolo ipak možete dodati, ali ${unused} ruta neće se računati u ligaški poredak.`),
  ];

  for (const rule of rules) {
    const translated = rule();
    if (translated) return translated;
  }
  return value;
}
