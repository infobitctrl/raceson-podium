/** Only recognized public reason codes become copy; never display provider errors. */
export function sponsorResultHold(reason: string, hr: boolean): string {
  const messages: Record<string, [string, string]> = {
    not_connected: ["Link the official league, round and reward categories before launching the campaign.", "Povežite službenu ligu, kolo i kategorije nagrada prije pokretanja kampanje."],
    source_changed: ["The official source has changed. The results team must review the current source again.", "Službeni izvor se promijenio. Tim za rezultate mora ponovno pregledati aktualni izvor."],
    source_missing: ["Official results are not linked for this pot.", "Službeni rezultati nisu povezani s ovim fondom."],
    source_held: ["The results team has not confirmed these results as final.", "Tim za rezultate nije potvrdio ove rezultate kao konačne."],
    incomplete_results: ["The official result list is incomplete.", "Popis službenih rezultata nije potpun."],
    ambiguous_results: ["Duplicate athlete entries or unresolved result statuses need correction by the results team.", "Tim za rezultate mora ispraviti ponovljene zapise sportaša ili neriješene statuse rezultata."],
    league_not_final: ["League rewards stay reserved until all rounds and the final league standings are confirmed.", "Nagrade lige ostaju rezervirane dok nisu potvrđena sva kola i konačni poredak lige."],
    standings_missing: ["The official standings for a reward category are missing.", "Nedostaje službeni poredak za kategoriju nagrada."],
    incomplete_standings: ["Some finishers are missing a reward classification or the category standings are incomplete.", "Nekim sportašima nedostaje klasifikacija nagrade ili poredak kategorije nije potpun."],
    invalid_standings: ["The category standings need correction before awards can be approved.", "Poredak kategorije treba ispraviti prije odobravanja nagrada."],
    missing_distance: ["Verified course distances are required for distance-based awards.", "Za nagrade prema udaljenosti potrebne su potvrđene duljine staza."],
    club_attribution_unresolved: ["Club representation needs confirmation for the affected results.", "Za navedene rezultate treba potvrditi zastupanje kluba."],
    empty_pot: ["This pot has no prize budget.", "Ovaj fond nema proračun za nagrade."],
  };
  return (messages[reason] ?? ["The results team must resolve the official source before approving awards.", "Tim za rezultate mora razriješiti službeni izvor prije odobravanja nagrada."])[hr ? 1 : 0];
}
