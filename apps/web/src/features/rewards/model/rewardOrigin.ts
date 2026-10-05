import type { AthleteAllocationV3 } from "@raceson/domain/rewards/athlete-allocations-v3";

export function rewardOrigin(award: AthleteAllocationV3, locale: string) {
  const hr = locale === "hr", origin = award.origin;
  const synthetic = origin?.sourceKind === "synthetic_rehearsal" || award.sourceKind === "synthetic_rehearsal"
    || award.breakdown?.sourceKind === "synthetic_rehearsal" || award.ageStatus === "synthetic_test";
  const pot = award.slot === 6 ? (hr ? "Ligaški fond" : "League pot")
    : `${hr ? "Fond kola" : "Round pot"} ${award.slot}`;
  return {
    event: origin?.eventName ?? null,
    programme: origin?.programmeName ?? `${hr ? "Program" : "Programme"} …${award.draftId.slice(-8)}`,
    host: origin?.hostName ?? null,
    pot, synthetic,
    date: origin?.eventDate ? new Intl.DateTimeFormat(hr ? "hr-HR" : "en-GB", { dateStyle:"medium", timeZone:"UTC" }).format(new Date(origin.eventDate)) : null,
  };
}
