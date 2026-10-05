import { countryName } from "@/shared/domain/countries";

export type EventEntryFee = {
  amountCents: number;
  currency: string;
};

// Keep race distances visually unambiguous: a dot is always the decimal mark,
// grouping is disabled, and insignificant trailing zeroes are omitted.
export function formatEventDistanceKm(distanceKm: number, _locale = "en-US") {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
    useGrouping: false,
  }).format(distanceKm);
}

function formatEntryFee(fee: EventEntryFee) {
  if (fee.amountCents === 0) return "Free";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: fee.currency,
    maximumFractionDigits: fee.amountCents % 100 === 0 ? 0 : 2,
  }).format(fee.amountCents / 100);
}

export function formatEventEntryFees(fees: EventEntryFee[]) {
  const distinctFees = Array.from(
    new Map(
      fees
        .filter((fee) => Number.isInteger(fee.amountCents) && fee.amountCents >= 0 && /^[A-Z]{3}$/.test(fee.currency))
        .map((fee) => [`${fee.currency}:${fee.amountCents}`, fee]),
    ).values(),
  ).sort((left, right) => (
    left.amountCents - right.amountCents || left.currency.localeCompare(right.currency)
  ));

  return distinctFees.length ? distinctFees.map(formatEntryFee).join(" / ") : "TBA";
}

export function formatEventPriceLabels(labels: Array<string | null | undefined>) {
  const distinctLabels = Array.from(
    new Set(labels.map((label) => label?.trim()).filter((label): label is string => Boolean(label))),
  );
  return distinctLabels.length ? distinctLabels.join(" / ") : "TBA";
}

/** Localize a generated, single-day English date, not custom schedules/ranges. */
export function localizedEventDateLabel(label: string, localeTag: string) {
  if (!localeTag.startsWith("hr") || !/^[A-Za-z]+ \d{1,2}, \d{4}$/.test(label)) return label;
  const parsed = new Date(label);
  if (Number.isNaN(parsed.getTime())) return label;
  return new Intl.DateTimeFormat("hr-HR", { day: "numeric", month: "long", year: "numeric" }).format(parsed);
}

/** Normalize generated kilometre labels while leaving custom copy untouched. */
export function localizedEventDistanceLabel(label: string, _localeTag: string) {
  if (!/^(?:\d+(?:[.,]\d+)?(?: km)?\s*\/\s*)*\d+(?:[.,]\d+)? km$/.test(label)) return label;
  return label.replace(/\d+(?:[.,]\d+)?/g, (value) => (
    formatEventDistanceKm(Number(value.replace(",", ".")))
  ));
}

/** Format application-generated fee labels, leaving custom descriptions intact. */
export function localizedEventPriceLabel(label: string, localeTag: string) {
  if (!localeTag.startsWith("hr")) return label;
  return label.split(" / ").map((part) => {
    if (part === "Free") return "Besplatno";
    if (part === "TBA" || part === "Fee TBA") return "Cijena još nije objavljena";
    const euroAmount = /^€(\d+(?:,\d{3})*(?:\.\d{1,2})?)$/.exec(part);
    if (!euroAmount) return part;
    const amount = Number(euroAmount[1].replaceAll(",", ""));
    return new Intl.NumberFormat("hr-HR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }).join(" / ");
}

export function eventCountryLabel(countryCode: string | null | undefined) {
  return countryName(countryCode || "HR", "Croatia");
}
