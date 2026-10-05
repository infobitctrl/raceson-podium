import { type RaceFeePeriod } from "@raceson/domain/categories";
import { useI18n } from "@/shared/i18n/I18nContext";

export function RaceFeePeriods({ periods, currency = "EUR", startAt, timezone = "Europe/Zagreb" }: {
  periods?: RaceFeePeriod[]; currency?: string; startAt?: string | null; timezone?: string;
}) {
  const { locale, localeTag } = useI18n();
  if (!periods?.length) return null;
  const hr = locale === "hr";
  const date = (value: string) => new Intl.DateTimeFormat(localeTag, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
  return <section className="my-4 rounded-xl border border-border p-4" data-i18n-skip="true">
    <h3 className="font-semibold">{hr ? "Cijene po razdobljima" : "Price periods"}</h3>
    <dl className="mt-3 space-y-3 text-sm">{periods.map((period, i) => <div key={i} className="flex flex-wrap justify-between gap-2">
      <dt>{i === 0 ? (hr ? "Od objave" : "From publication") : date(periods[i - 1].until!)} — {period.until ? date(period.until) : startAt ? date(startAt) : (hr ? "do utrke" : "until race")}</dt>
      <dd className="font-semibold">{new Intl.NumberFormat(localeTag, { style: "currency", currency }).format(period.amountCents / 100)}</dd>
    </div>)}</dl>
    <p className="mt-3 text-xs text-muted-foreground">{hr ? "Na datum promjene vrijedi nova cijena. Prijava zadržava cijenu iz trenutka prijave." : "The new price applies at each change time. Registrations retain the price quoted when created."} ({timezone})</p>
  </section>;
}
