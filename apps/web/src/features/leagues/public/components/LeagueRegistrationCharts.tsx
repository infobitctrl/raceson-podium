import { useMemo } from "react";
import { useI18n } from "@/shared/i18n/I18nContext";
import { localizedLeagueDataLabel } from "@/features/leagues/public/model/leagueLocale";
import type { LeagueRegistrationRound } from "../model/leagueRegistrationCharts";

const COURSE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--trail-green))",
  "hsl(var(--trail-blue))",
  "hsl(var(--trail-amber))",
  "hsl(var(--trail-moss))",
  "hsl(var(--trail-earth))",
  "hsl(var(--foreground))",
];

const CHART_HEIGHT = 276;
const MARGIN = { top: 34, right: 24, bottom: 46, left: 46 } as const;

function chartWidth(roundCount: number) {
  return Math.max(560, MARGIN.left + MARGIN.right + roundCount * 64);
}

function axisMaximum(value: number) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const rounded = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return rounded * magnitude;
}

function axisTicks(maximum: number) {
  return Array.from({ length: 5 }, (_, index) => Math.round(maximum / 4 * index));
}

export function LeagueRegistrationCharts({ rounds }: { rounds: LeagueRegistrationRound[] }) {
  const { formatNumber, locale, t } = useI18n();
  const courses = useMemo(() => {
    const byId = new Map<string, { id: string; label: string; order: number }>();
    rounds.forEach((round) => round.courses.forEach((course) => {
      if (!byId.has(course.id)) byId.set(course.id, course);
    }));
    return Array.from(byId.values())
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
  }, [rounds]);
  const courseColor = new Map(courses.map((course, index) => [course.id, COURSE_COLORS[index % COURSE_COLORS.length]!]));
  const totalRegistrations = rounds.at(-1)?.cumulativeRegistrations ?? 0;
  const latestRound = rounds.at(-1)?.roundNumber ?? 0;
  const width = chartWidth(rounds.length);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const xFor = (index: number) => MARGIN.left + (rounds.length <= 1 ? plotWidth / 2 : index / (rounds.length - 1) * plotWidth);

  if (!rounds.length) {
    return (
      <section className="rounded-[28px] border border-dashed border-border bg-muted/15 px-5 py-10 text-center text-sm text-muted-foreground">
        {t("league.stats.noRegistrationData")}
      </section>
    );
  }

  const cumulativeMaximum = axisMaximum(totalRegistrations);
  const cumulativeY = (value: number) => MARGIN.top + plotHeight - value / cumulativeMaximum * plotHeight;
  const cumulativePath = rounds.map((round, index) => `${index ? "L" : "M"} ${xFor(index)} ${cumulativeY(round.cumulativeRegistrations)}`).join(" ");
  const roundMaximum = axisMaximum(Math.max(0, ...rounds.map((round) => round.registrations)));
  const roundY = (value: number) => MARGIN.top + plotHeight - value / roundMaximum * plotHeight;
  const slotWidth = plotWidth / Math.max(1, rounds.length);
  const barWidth = Math.min(40, slotWidth * 0.68);
  return (
    <section className="space-y-5" aria-label={t("league.stats.registrationCharts")}>
      <div data-registration-chart-grid className="grid min-w-0 gap-5 xl:grid-cols-2">
        <figure className="min-w-0 overflow-hidden rounded-[28px] border border-border bg-card shadow-soft">
          <figcaption className="flex flex-wrap items-end justify-between gap-4 border-b border-border/70 px-5 py-5 sm:px-7">
            <div className="max-w-2xl">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--trail-green))]">{t("league.stats.registrationGrowth")}</div>
              <h2 className="mt-1 font-display text-xl font-black">{t("league.stats.cumulativeRegistrations")}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("league.stats.cumulativeRegistrationsDescription")}</p>
            </div>
            <p className="text-right"><strong className="block font-display text-2xl font-black tabular-nums">{formatNumber(totalRegistrations)}</strong><span className="text-[0.62rem] font-bold text-muted-foreground">{t("league.stats.throughRound", { round: latestRound })}</span></p>
          </figcaption>
          <div className="min-w-0 overflow-hidden px-3 pb-4 pt-2" role="img" aria-label={t("league.stats.registrationTrendAria")}>
            <svg data-registration-chart="cumulative" aria-hidden="true" viewBox={`0 0 ${width} ${CHART_HEIGHT}`} className="block h-auto w-full">
              {axisTicks(cumulativeMaximum).map((tick) => {
                const y = cumulativeY(tick);
                return <g key={tick}><line x1={MARGIN.left} x2={width - MARGIN.right} y1={y} y2={y} stroke="hsl(var(--border))" strokeDasharray="3 5" /><text x={MARGIN.left - 8} y={y + 4} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="10">{formatNumber(tick)}</text></g>;
              })}
              <path d={cumulativePath} fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
              {rounds.map((round, index) => {
                const x = xFor(index);
                const y = cumulativeY(round.cumulativeRegistrations);
                return <g key={round.roundNumber} data-registration-cumulative={round.cumulativeRegistrations}><circle cx={x} cy={y} r="5" fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth="3"><title>{t("league.stats.cumulativePoint", { round: round.roundNumber, count: round.cumulativeRegistrations })}</title></circle><text x={x} y={CHART_HEIGHT - 13} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="10" fontWeight="700">R{round.roundNumber}</text></g>;
              })}
              {rounds.length ? <text x={xFor(rounds.length - 1) - 8} y={Math.max(16, cumulativeY(totalRegistrations) - 10)} textAnchor="end" fill="hsl(var(--foreground))" fontSize="12" fontWeight="800">{formatNumber(totalRegistrations)}</text> : null}
            </svg>
          </div>
        </figure>

        <figure className="min-w-0 overflow-hidden rounded-[28px] border border-border bg-card shadow-soft">
          <figcaption className="border-b border-border/70 px-5 py-5 sm:px-7">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{t("league.stats.registrationComposition")}</div>
            <h2 className="mt-1 font-display text-xl font-black">{t("league.stats.registrationsByCourse")}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("league.stats.registrationsByCourseDescription")}</p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2" aria-label={t("league.stats.courseLegend")}>
              {courses.map((course) => <span key={course.id} className="inline-flex items-center gap-2 text-[0.62rem] font-black text-muted-foreground"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: courseColor.get(course.id) }} aria-hidden="true" />{localizedLeagueDataLabel(course.label, locale)}</span>)}
            </div>
          </figcaption>
          <div className="min-w-0 overflow-hidden px-3 pb-4 pt-2" role="img" aria-label={t("league.stats.registrationMixAria")}>
            <svg data-registration-chart="courses" aria-hidden="true" viewBox={`0 0 ${width} ${CHART_HEIGHT}`} className="block h-auto w-full">
              {axisTicks(roundMaximum).map((tick) => {
                const y = roundY(tick);
                return <g key={tick}><line x1={MARGIN.left} x2={width - MARGIN.right} y1={y} y2={y} stroke="hsl(var(--border))" strokeDasharray="3 5" /><text x={MARGIN.left - 8} y={y + 4} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="10">{formatNumber(tick)}</text></g>;
              })}
              {rounds.map((round, index) => {
                const x = xFor(index);
                let stacked = 0;
                return (
                  <g key={round.roundNumber} data-registration-round={round.registrations}>
                    {courses.map((course) => {
                      const registrations = round.courses.find((item) => item.id === course.id)?.registrations ?? 0;
                      const yTop = roundY(stacked + registrations);
                      const height = roundY(stacked) - yTop;
                      stacked += registrations;
                      if (!registrations) return null;
                      return <g key={course.id} data-course-registrations={`${course.label}:${registrations}`}><rect x={x - barWidth / 2} y={yTop} width={barWidth} height={height} rx="4" fill={courseColor.get(course.id)} stroke="hsl(var(--card))"><title>{t("league.stats.coursePoint", { round: round.roundNumber, course: localizedLeagueDataLabel(course.label, locale), count: registrations })}</title></rect>{height >= 20 ? <text x={x} y={yTop + height / 2 + 3} textAnchor="middle" fill="white" fontSize="10" fontWeight="900" stroke="hsl(var(--foreground) / 0.24)" strokeWidth="1.5" paintOrder="stroke">{formatNumber(registrations)}</text> : null}</g>;
                    })}
                    <text x={x} y={Math.max(15, roundY(round.registrations) - 7)} textAnchor="middle" fill="hsl(var(--foreground))" fontSize="10" fontWeight="800">{formatNumber(round.registrations)}</text>
                    <text x={x} y={CHART_HEIGHT - 22} textAnchor="middle" fill="hsl(var(--foreground))" fontSize="10" fontWeight="900">R{round.roundNumber}</text>
                    <text x={x} y={CHART_HEIGHT - 9} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="8" fontWeight="700">{round.label.length > 12 ? `${round.label.slice(0, 11)}…` : round.label}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        </figure>
      </div>

      <details className="rounded-2xl border border-border bg-card px-5 py-4 shadow-soft">
        <summary className="cursor-pointer text-sm font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t("league.stats.registrationData")}</summary>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead><tr className="border-b border-border text-[0.58rem] font-black uppercase tracking-[0.1em] text-muted-foreground"><th className="px-3 py-2 text-left">{t("league.results.round")}</th>{courses.map((course) => <th key={course.id} className="px-3 py-2 text-right">{localizedLeagueDataLabel(course.label, locale)}</th>)}<th className="px-3 py-2 text-right">{t("league.stats.roundTotal")}</th><th className="px-3 py-2 text-right">{t("league.stats.cumulative")}</th></tr></thead>
            <tbody>{rounds.map((round) => <tr key={round.roundNumber} className="border-b border-border/60 last:border-b-0"><th className="px-3 py-2 text-left font-black">R{round.roundNumber}<span className="ml-2 font-medium text-muted-foreground">{round.label}</span></th>{courses.map((course) => <td key={course.id} className="px-3 py-2 text-right tabular-nums">{formatNumber(round.courses.find((item) => item.id === course.id)?.registrations ?? 0)}</td>)}<td className="px-3 py-2 text-right font-black tabular-nums">{formatNumber(round.registrations)}</td><td className="px-3 py-2 text-right font-black tabular-nums text-primary">{formatNumber(round.cumulativeRegistrations)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
