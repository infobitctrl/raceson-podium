// Presentation hints never authorize a source, profile or payment. All reads
// and writes remain in the shared authenticated reward adapters.
export function presentationLink(pathname: string, search: string, hash: string, classic: boolean) {
  const query = new URLSearchParams(search);
  if (classic) query.set("experience", "classic"); else query.delete("experience");
  return pathname + (query.toString() ? `?${query}` : "") + hash;
}

export function contextLink(scope: { draft?: string; event?: string; season?: string } = {}) {
  const query = new URLSearchParams();
  for (const key of ["draft", "event", "season"] as const) if (scope[key]) query.set(key, scope[key]!);
  return "/organizer/reward-context" + (query.toString() ? `?${query}` : "");
}

export const portalCopy = (locale: string) => locale === "hr" ? {
  title: "Klasični RacesOn demo", context: "Događaji, rezultati i nagrade", standalone: "Samostalne nagrade", classic: "Otvori klasični demo",
  notice: "Isti program, iznosi i potvrde isplate. Promjena prikaza ne stvara novu nagradu.",
  setup: "Postavke i raspodjela nagrada", events: "Događaji", results: "Rezultati", league: "Liga", athlete: "Moje nagrade i potvrde", club: "Klupske nagrade",
  loading: "Učitavanje izvora iz demo baze…", error: "Izvor nije dostupan. Status nagrada nije poznat. Pokušajte ponovno.", retry: "Pokušaj ponovno",
  empty: "Nema programa za odabrani kontekst u ovoj organizaciji.", revision: "Revizija pravila", mapping: "Revizija povezivanja", publication: "Objava rezultata",
  sourceNotice: "Katalog izvora služi povezivanju. Objava rezultata nije odobrenje raspodjele niti potvrda isplate. Uvezene reference nisu lokalne stranice događaja.",
  pending: "Izvor nije povezan", choose: "Program", finale: "Peto kolo: provjerite zasebno povezivanje finala u postavkama. Stvarni Šubićevac nije potvrđen ovom demonstracijom.",
} : {
  title: "Classic RacesOn demo", context: "Events, results and rewards", standalone: "Standalone rewards", classic: "Open classic demo",
  notice: "The same programme, amounts and payment receipts. Changing presentation creates no new award.",
  setup: "Reward setup and distribution", events: "Events", results: "Results", league: "League", athlete: "My rewards and receipts", club: "Club rewards",
  loading: "Loading sources from the demo database…", error: "Source unavailable. Reward status is unknown. Please retry.", retry: "Retry",
  empty: "No programme matches this context in the selected organization.", revision: "Rules revision", mapping: "Mapping revision", publication: "Result publication",
  sourceNotice: "This source catalogue supports mapping. Result publication is not allocation approval or a payment receipt. Imported references are not local event pages.",
  pending: "Source not mapped", choose: "Programme", finale: "Round five: inspect the separate finale binding in setup. This demonstration does not verify the real Šubićevac event.",
};
