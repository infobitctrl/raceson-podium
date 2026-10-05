import { BarChart3, Footprints, Heart, Info, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { PortalEventCategory } from "@/lib/portal-data";
import type { PublicEventParticipantRow } from "@/lib/portal-read-models";
import { EventFinishTimePlot } from "./EventFinishTimePlot";
import { EventParticipationFlow } from "./EventParticipationFlow";
import { EventStatisticsScopeToggle } from "./EventStatisticsScopeToggle";
import { buildEventStatistics, type EventCategoryStatistics } from "../model/eventStatistics";

const CARD_CLASS = "min-w-0 rounded-[1.35rem] border border-border/80 bg-card shadow-soft";

function StoryFact({
  icon: Icon,
  value,
  detail,
}: {
  icon: typeof Heart;
  value: string;
  detail: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[2.35rem_minmax(0,1fr)] gap-3 border-t border-border/80 py-4 first:border-t-0 lg:border-l lg:border-t-0 lg:pl-5">
      <Icon className="mt-0.5 h-7 w-7 text-muted-foreground/75" strokeWidth={1.65} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-black leading-5 text-foreground">{value}</p>
        <p className="mt-0.5 text-[0.68rem] leading-5 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function combinedCategory(statistics: ReturnType<typeof buildEventStatistics>, name: string): EventCategoryStatistics {
  return {
    slug: "all-races",
    name,
    entries: statistics.entries,
    capacity: null,
    starters: statistics.starters,
    finishers: statistics.finishers,
    didNotFinish: statistics.didNotFinish,
    didNotStart: statistics.didNotStart,
    finishRate: statistics.finishRate,
    startAtIso: null,
    classificationGroups: [],
    finishTimes: statistics.categories.flatMap((category) => category.finishTimes).sort((left, right) => left.finishTimeMs - right.finishTimeMs),
  };
}

export function EventStatisticsPanel({
  eventName,
  categories,
  rows,
  selectedCategorySlug: selectedCategorySlugProp,
  onSelectedCategorySlugChange,
}: {
  eventName: string;
  categories: PortalEventCategory[];
  rows: PublicEventParticipantRow[];
  selectedCategorySlug?: string | null;
  onSelectedCategorySlugChange?: (categorySlug: string) => void;
}) {
  const { t, localeTag } = useI18n();
  const statistics = useMemo(() => buildEventStatistics(categories, rows), [categories, rows]);
  const [flowCombined, setFlowCombined] = useState(false);
  const [timesCombined, setTimesCombined] = useState(false);
  const [localCategorySlug, setLocalCategorySlug] = useState(statistics.categories[0]?.slug ?? "");
  const selectedCategorySlug = selectedCategorySlugProp ?? localCategorySlug;
  const selectedCategory = statistics.categories.find((category) => category.slug === selectedCategorySlug)
    ?? statistics.categories[0]
    ?? null;
  const female = statistics.genderDistribution.find((group) => group.label === "Female");
  const male = statistics.genderDistribution.find((group) => group.label === "Male");
  const flowCategories = flowCombined ? [combinedCategory(statistics, t("common.allRaces"))] : statistics.categories;
  const topClubs = statistics.clubEntries.slice(0, 5);
  const largestClub = Math.max(1, ...topClubs.map((club) => club.entries));
  const classificationGroups = selectedCategory?.classificationGroups.filter((group) => group.label !== "Not specified") ?? [];
  const unspecifiedClassifications = selectedCategory?.classificationGroups.find((group) => group.label === "Not specified")?.count ?? 0;
  const largestClassificationGroup = Math.max(1, ...classificationGroups.map((group) => group.count));
  const headline = statistics.starters > 0
    ? t("event.detail.stats.started", { count: statistics.starters })
    : statistics.entries > 0
      ? t("event.detail.stats.entered", { count: statistics.entries })
      : t("event.detail.stats.waiting");
  const headlineDetail = statistics.starters > 0
    ? t("event.detail.stats.startedDetail", { event: eventName, finishers: statistics.finishers })
    : statistics.entries > 0
      ? t("event.detail.stats.enteredDetail")
      : t("event.detail.stats.emptyDetail");
  const updatedLabel = statistics.latestPublishedAt
    ? new Intl.DateTimeFormat(localeTag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(statistics.latestPublishedAt))
    : null;

  return (
    <div id="statistics" className="container mx-auto space-y-4 px-4 pb-14 pt-5 sm:pt-7">
      <section className="grid min-w-0 gap-x-6 lg:grid-cols-[minmax(22rem,1.55fr)_repeat(3,minmax(10rem,0.45fr))] lg:items-center" aria-labelledby="event-statistics-story-title">
        <div className="min-w-0 pb-3 lg:pb-0">
          <p className="text-[0.64rem] font-black uppercase tracking-[0.13em] text-primary">Race day, decoded</p>
          <h2 id="event-statistics-story-title" className="mt-2 max-w-3xl font-display text-3xl font-black uppercase leading-[0.96] tracking-[-0.035em] text-foreground sm:text-4xl xl:text-[2.8rem]">
            {headline}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{headlineDetail}</p>
        </div>

        <StoryFact
          icon={Footprints}
          value={statistics.multiCourseAthletes > 0 ? t("event.detail.stats.multiple", { count: statistics.multiCourseAthletes }) : t("event.detail.stats.single")}
          detail={t("event.detail.stats.entryAthletes", { entries: statistics.entries, athletes: statistics.uniqueAthletes })}
        />
        <StoryFact
          icon={Heart}
          value={statistics.finishRate === null ? t("event.detail.stats.noFinishes") : t("event.detail.stats.finishRate", { percent: statistics.finishRate })}
          detail={statistics.starters ? t("event.detail.stats.finishCounts", { finishers: statistics.finishers, starters: statistics.starters }) : t("event.detail.stats.noStarters")}
        />
        <StoryFact
          icon={Users}
          value={female && male ? t("event.detail.stats.genderShare", { female: female.percent, male: male.percent }) : t("event.detail.stats.genderMissing")}
          detail={female && male ? t("event.detail.stats.basedOnRegistrations") : t("event.detail.stats.demographicsMissing")}
        />
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <figure className={`${CARD_CLASS} p-4 sm:p-5`} aria-labelledby="event-flow-title">
          <figcaption className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 id="event-flow-title" className="font-display text-lg font-black tracking-[-0.02em]">{t("event.detail.stats.flowTitle")}</h3>
              <p className="mt-0.5 flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">Race-day flow by route <Info className="h-3.5 w-3.5" aria-hidden="true" /></p>
            </div>
            <EventStatisticsScopeToggle combined={flowCombined} onChange={setFlowCombined} label="Change participation-flow scope" />
          </figcaption>
          <EventParticipationFlow categories={flowCategories} />
          {statistics.didNotStart > 0 ? <p className="-mt-1 hidden pr-4 text-right font-display text-sm italic text-muted-foreground sm:block">{t("event.detail.stats.dns", { count: statistics.didNotStart })}</p> : null}
          <p className="mt-2 flex items-center gap-2 text-[0.65rem] leading-5 text-muted-foreground"><Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Registered splits into starters and DNS; starters split into finishers and DNF.</p>
        </figure>

        <figure className={`${CARD_CLASS} p-4 sm:p-5`} aria-labelledby="event-finish-time-title">
          <figcaption className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 id="event-finish-time-title" className="font-display text-lg font-black tracking-[-0.02em]">When the finish arch got busy.</h3>
              <p className="mt-0.5 flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">Finish rhythm · local clock where race start is published <Info className="h-3.5 w-3.5" aria-hidden="true" /></p>
            </div>
            <EventStatisticsScopeToggle combined={timesCombined} onChange={setTimesCombined} label="Change finish-time scope" />
          </figcaption>
          <EventFinishTimePlot categories={statistics.categories} combined={timesCombined} />
          <p className="mt-2 flex items-center gap-2 text-[0.65rem] leading-5 text-muted-foreground"><Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Each dot is a finisher. Combined view compares elapsed times across routes.</p>
        </figure>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[1.05fr_0.95fr_0.9fr]">
        <section className={`${CARD_CLASS} p-4 sm:p-5`} aria-labelledby="event-club-caravan-title">
          <div>
            <h3 id="event-club-caravan-title" className="font-display text-lg font-black tracking-[-0.02em]">Club caravan.</h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">Top clubs by entries <Info className="h-3.5 w-3.5" aria-hidden="true" /></p>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-start">
            <dl className="grid grid-cols-3 gap-3 sm:grid-cols-1 sm:gap-2 sm:border-r sm:border-border/80 sm:pr-4">
              <div><dt className="sr-only">Entries with a club</dt><dd className="font-display text-lg font-black">{statistics.clubAttributedEntries}</dd><p className="text-[0.6rem] leading-4 text-muted-foreground">{t("event.detail.stats.withClub")}</p></div>
              <div><dt className="sr-only">Independent entries</dt><dd className="font-display text-lg font-black">{statistics.independentEntries}</dd><p className="text-[0.6rem] leading-4 text-muted-foreground">entered independently</p></div>
              <div><dt className="sr-only">Clubs represented</dt><dd className="font-display text-lg font-black">{statistics.clubs}</dd><p className="text-[0.6rem] leading-4 text-muted-foreground">clubs represented</p></div>
            </dl>

            {topClubs.length ? (
              <ol className="space-y-3" aria-label="Top clubs by race entries">
                {topClubs.map((club, index) => (
                  <li key={`${club.slug ?? club.name}-${index}`} className="grid min-w-0 grid-cols-[1rem_minmax(5.5rem,0.8fr)_minmax(4rem,1.4fr)_1.6rem] items-center gap-2 text-[0.68rem]">
                    <span className="font-black text-muted-foreground">{index + 1}</span>
                    <span className="truncate font-bold">{club.name}</span>
                    <span className="relative block h-px bg-border" aria-hidden="true"><span className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${club.entries / largestClub * 100}%` }} /><span className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-primary" style={{ left: `calc(${club.entries / largestClub * 100}% - 0.31rem)` }} /></span>
                    <span className="text-right font-black">{club.entries}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm leading-6 text-muted-foreground">Club names have not been published for this start list.</p>}
          </div>
          <p className="mt-5 flex items-center gap-2 text-[0.65rem] leading-5 text-muted-foreground"><Users className="h-4 w-4 shrink-0" aria-hidden="true" /> Entry counts show the club footprint without exposing extra profile details.</p>
        </section>

        <section className={`${CARD_CLASS} p-4 sm:p-5`} aria-labelledby="event-classification-title">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 id="event-classification-title" className="font-display text-lg font-black tracking-[-0.02em]">Who showed up?</h3>
              <p className="mt-0.5 flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">{t("event.detail.stats.classificationDistribution")} <Info className="h-3.5 w-3.5" aria-hidden="true" /></p>
            </div>
            {statistics.categories.length > 1 ? (
              <div className="flex max-w-full overflow-x-auto rounded-xl border border-border/80 bg-muted/25 p-1" aria-label={t("event.detail.stats.classificationScope")}>
                {statistics.categories.map((category) => (
                  <button
                    key={category.slug}
                    type="button"
                    aria-pressed={selectedCategory?.slug === category.slug}
                    onClick={() => {
                      if (selectedCategorySlugProp == null) setLocalCategorySlug(category.slug);
                      onSelectedCategorySlugChange?.(category.slug);
                    }}
                    className={`min-h-9 shrink-0 rounded-lg px-3 text-[0.62rem] font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selectedCategory?.slug === category.slug ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {classificationGroups.length ? (
            <ol className="mt-5 space-y-2.5" aria-label={t("event.detail.stats.classificationList", { race: selectedCategory?.name ?? "Race" })}>
              {classificationGroups.map((group, index) => (
                <li key={group.label} className="grid grid-cols-[1rem_minmax(4.2rem,7rem)_minmax(0,1fr)_auto] items-center gap-2 text-[0.66rem]">
                  <span className="font-black text-muted-foreground">{index + 1}</span>
                  <span className="truncate font-bold">{group.label}</span>
                  <span className="h-3 overflow-hidden rounded-sm bg-muted/70" aria-hidden="true"><span className="block h-full bg-gradient-to-r from-primary/35 to-primary/75" style={{ width: `${Math.max(3, group.count / largestClassificationGroup * 100)}%` }} /></span>
                  <span className="whitespace-nowrap font-black">{group.count} <span className="font-bold text-muted-foreground">({group.percent}%)</span></span>
                </li>
              ))}
            </ol>
          ) : <p className="mt-5 text-sm leading-6 text-muted-foreground">{t("event.detail.stats.classificationEmpty")}</p>}

          <p className="mt-5 text-[0.65rem] italic leading-5 text-muted-foreground">
            {selectedCategory ? t("event.detail.stats.classificationContext", { race: selectedCategory.name }) : t("event.detail.stats.classificationFallback")}
            {unspecifiedClassifications ? ` ${t("event.detail.stats.classificationMissing", { count: unspecifiedClassifications })}` : ""}
          </p>
        </section>

        <section className={`${CARD_CLASS} p-4 sm:p-5`} aria-labelledby="event-method-title">
          <h3 id="event-method-title" className="font-display text-lg font-black tracking-[-0.02em]">Behind the numbers.</h3>
          <dl className="mt-5 space-y-3">
            {[
              { label: "Registered", value: statistics.entries, color: "bg-primary", detail: "Entries on the public registration roster." },
              { label: "Started", value: statistics.starters, color: "bg-primary/65", detail: "Athletes with a published race-day start state." },
              { label: "Finished", value: statistics.finishers, color: "bg-[hsl(var(--trail-green))]", detail: "Starters with a published finish result." },
              { label: "DNF", value: statistics.didNotFinish, color: "bg-[hsl(var(--trail-blue))]", detail: "Started but did not record a finish." },
              { label: "DNS", value: statistics.didNotStart, color: "bg-muted-foreground/45", detail: "Registered but not counted as a starter." },
            ].map((item) => (
              <div key={item.label} className="grid grid-cols-[0.7rem_4.2rem_2rem_minmax(0,1fr)] items-start gap-2 text-[0.63rem] leading-4">
                <span className={`mt-1 h-2.5 w-2.5 rounded-full ${item.color}`} aria-hidden="true" />
                <dt className="font-black">{item.label}</dt>
                <dd className="font-display font-black tabular-nums">{item.value}</dd>
                <dd className="text-muted-foreground">{item.detail}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 flex items-start gap-2 border-t border-border/75 pt-4 text-[0.63rem] leading-5 text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Registered = started + DNS. Started = finished + DNF in this public snapshot.</p>
        </section>
      </div>

      <footer className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card px-4 py-3 text-[0.63rem] leading-5 text-muted-foreground sm:flex-row sm:items-center sm:px-5">
        <div className="flex shrink-0 items-center gap-2 font-black text-foreground"><BarChart3 className="h-4 w-4" aria-hidden="true" /> {t("event.detail.stats.source")}</div>
        <p>
          {t("event.detail.stats.sourceDescription")}{updatedLabel ? ` ${t("event.detail.stats.updated", { date: updatedLabel })}` : ""}
        </p>
      </footer>
    </div>
  );
}
