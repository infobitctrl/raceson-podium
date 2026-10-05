import { useId, useState } from "react";
import { DistributionDonut } from "@/shared/statistics/DistributionDonut";
import {
  InteractiveChartTooltip,
  type InteractiveChartTooltipDatum,
} from "@/shared/statistics/InteractiveChartTooltip";
import type {
  LeagueAthleteParticipation,
  LeagueClubPresence,
  LeagueCourseAgeDistribution,
  LeagueDemographicItem,
  LeagueDistanceCategoryInsight,
  LeagueLeaderTakeover,
  LeagueRaceAgeCell,
  LeagueRankHistory,
  LeagueRankHistoryPoint,
  LeagueRoundInsight,
} from "../model/leagueInsights";
import type { LeagueCompetitionParticipation } from "../model/leagueRegistrationCharts";
import { useI18n } from "@/shared/i18n/I18nContext";
import { localizedLeagueDataLabel } from "@/features/leagues/public/model/leagueLocale";
import { localizedCountryName } from "@/shared/i18n/domainLabels";
import { buildLeagueChartAxis, formatLeagueChartTime, type LeagueChartMetric } from "../model/leagueChartScale";

// Data-driven RacesOn adaptations of the rounded micro-chart principles from
// Amicro Monocharts (MIT), pinned during design research to commit
// 114613e815076bb79ef6fe119d90493172df1756. The demo values were intentionally
// replaced with typed league inputs and accessible text equivalents.

const SERIES_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--trail-green))",
  "hsl(var(--foreground))",
  "hsl(var(--trail-blue))",
  "hsl(var(--trail-amber))",
  "hsl(var(--trail-moss))",
  "hsl(var(--trail-stone))",
  "hsl(var(--trail-earth))",
  "hsl(var(--trail-forest))",
  "hsl(var(--muted-foreground))",
];

const TOP_RANK_LIMIT = 10;
const DISTANCE_COLORS: Record<string, string> = {
  short: "hsl(var(--trail-forest))",
  medium: "hsl(var(--trail-green))",
  long: "hsl(var(--trail-amber))",
  "extra-long": "hsl(var(--primary))",
  marathon: "hsl(var(--trail-earth))",
  "ultra-marathon": "hsl(var(--foreground))",
};
const DEMOGRAPHIC_COLORS: Record<string, string> = {
  "Under 18": "hsl(var(--primary))",
  "18–34": "hsl(var(--trail-green))",
  "35–44": "hsl(var(--foreground))",
  "45–54": "hsl(var(--trail-blue))",
  "55–64": "hsl(var(--trail-amber))",
  "65+": "hsl(var(--trail-moss))",
  "Broad age range": "hsl(var(--trail-stone))",
  "Not specified": "hsl(var(--muted-foreground))",
};

const METRIC_LABELS = {
  rank: "league.rank.rank",
  points: "league.rank.points",
  best_time: "league.rules.bestTime",
  participation: "league.stats.participations",
} as const;

function RankRaceSvg({
  history,
  rounds,
  takeover,
  selectedSlug,
  onSelectedSlugChange,
  compact,
  expanded,
  metric,
}: {
  history: LeagueRankHistory[];
  rounds: LeagueRoundInsight[];
  takeover: LeagueLeaderTakeover | null;
  selectedSlug: string;
  onSelectedSlugChange: (slug: string) => void;
  compact: boolean;
  expanded: boolean;
  metric: LeagueChartMetric;
}) {
  const { formatNumber, t } = useI18n();
  const tooltipId = useId();
  const [activePoint, setActivePoint] = useState<(InteractiveChartTooltipDatum & { athleteSlug: string }) | null>(null);
  const visibleHistory = history.slice(0, TOP_RANK_LIMIT).map((series) => ({
    ...series,
    points: series.points.filter((point) => metric === "rank"
      ? point.rank <= TOP_RANK_LIMIT
      : Number.isFinite(point.points) && point.points >= 0),
  }));
  const width = compact ? Math.max(420, metric === "rank" ? 0 : rounds.length * 28 + 100) : 860;
  const height = compact ? 270 : expanded ? 500 : 350;
  const plot = compact
    ? { left: 46, right: 20, top: 38, bottom: 38 }
    : expanded
      ? { left: 58, right: 26, top: 50, bottom: 50 }
      : { left: 58, right: 26, top: 46, bottom: 44 };
  if (metric !== "rank") plot.left = compact ? 82 : 92;
  const innerWidth = width - plot.left - plot.right;
  const innerHeight = height - plot.top - plot.bottom;
  const pointValue = (point: LeagueRankHistoryPoint) => metric === "rank" ? point.rank : point.points;
  const axis = buildLeagueChartAxis(
    visibleHistory.flatMap((series) => series.points.map(pointValue)), metric,
  );
  const metricLabel = t(METRIC_LABELS[metric]);
  const formatValue = (value: number) => metric === "best_time" ? formatLeagueChartTime(value) : formatNumber(value);
  const roundIndex = new Map(rounds.map((round, index) => [round.roundNumber, index]));
  const x = (roundNumber: number) => {
    const index = roundIndex.get(roundNumber) ?? 0;
    return plot.left + (rounds.length <= 1 ? innerWidth / 2 : index / (rounds.length - 1) * innerWidth);
  };
  const valueY = (value: number) => plot.top + axis.position(value) * innerHeight;
  const pointY = (point: LeagueRankHistoryPoint) => valueY(pointValue(point));
  const pointLabel = (series: LeagueRankHistory, point: LeagueRankHistoryPoint) => (
    t(metric === "rank" ? "league.stats.pointAria" : "league.stats.scorePointAria", {
      name: series.name,
      round: point.round,
      projection: point.projected ? t("league.stats.projectedPrefix") : "",
      rank: point.rank,
      metric: metricLabel,
      value: formatValue(point.points),
    })
  );
  const ariaLabel = visibleHistory.map((series) => (
    `${series.name}: ${series.points.map((point) => pointLabel(series, point)).join(", ")}`
  )).join(". ");

  const highlightedSlug = activePoint?.athleteSlug ?? selectedSlug;

  return (
    <div className={metric !== "rank" && compact ? "overflow-x-auto" : "min-w-0"}>
    <div className="relative min-w-0" style={metric !== "rank" && compact ? { minWidth: width } : undefined}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full overflow-visible"
        role="group"
        aria-label={t(metric === "rank" ? "league.rank.interactiveAria" : "league.stats.scoreInteractiveAria", { metric: metricLabel, details: ariaLabel })}
      >
      <g aria-label={`${metricLabel} axis`}>
        <line
          data-rank-axis-line={metric === "rank" ? "true" : undefined}
          data-score-axis-line={metric !== "rank" ? metric : undefined}
          x1={plot.left}
          x2={plot.left}
          y1={plot.top}
          y2={height - plot.bottom}
          stroke="hsl(var(--border))"
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={plot.left}
          y={plot.top - (compact ? 12 : 16)}
          textAnchor="start"
          fontSize={compact ? 8 : expanded ? 10.5 : 9.5}
          fontWeight="900"
          fill="hsl(var(--muted-foreground))"
        >
          {metricLabel}
        </text>
        {axis.ticks.map((value) => (
          <g key={value}>
            <line
              x1={plot.left}
              x2={width - plot.right}
              y1={valueY(value)}
              y2={valueY(value)}
              stroke="hsl(var(--border))"
              strokeDasharray="3 7"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={plot.left - 4}
              x2={plot.left}
              y1={valueY(value)}
              y2={valueY(value)}
              stroke="hsl(var(--muted-foreground))"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={plot.left - 8}
              y={valueY(value) + 3.5}
              textAnchor="end"
              fontSize={metric !== "rank" ? 11 : compact ? 8 : expanded ? 10.5 : 9.5}
              fontWeight="800"
              fill="hsl(var(--muted-foreground))"
            >
              {formatValue(value)}
            </text>
          </g>
        ))}
      </g>

      {rounds.map((round, index) => {
        const previousX = index === 0 ? plot.left : x(rounds[index - 1]!.roundNumber);
        const nextX = index === rounds.length - 1 ? width - plot.right : x(rounds[index + 1]!.roundNumber);
        const bandLeft = index === 0 ? plot.left : (previousX + x(round.roundNumber)) / 2;
        const bandRight = index === rounds.length - 1 ? width - plot.right : (x(round.roundNumber) + nextX) / 2;
        const finishedWithoutPublishedResults = round.status === "completed" && !round.hasPublishedResults;
        return (
          <g key={round.roundId}>
            {!round.hasPublishedResults ? (
              <rect
                aria-label={t("league.rank.round", { round: round.roundNumber }) + ": " + (finishedWithoutPublishedResults ? t("league.rank.finished") : t("league.rank.waiting"))}
                x={bandLeft + 3}
                y={plot.top - 18}
                width={Math.max(18, bandRight - bandLeft - 6)}
                height={innerHeight + 28}
                rx="14"
                fill={finishedWithoutPublishedResults ? "hsl(var(--trail-green) / 0.08)" : "hsl(var(--muted) / 0.18)"}
                stroke={finishedWithoutPublishedResults ? "hsl(var(--trail-green) / 0.58)" : "hsl(var(--muted-foreground) / 0.48)"}
                strokeDasharray={finishedWithoutPublishedResults ? undefined : "5 5"}
              />
            ) : (
              <line
                x1={x(round.roundNumber)}
                x2={x(round.roundNumber)}
                y1={plot.top}
                y2={height - plot.bottom}
                stroke="hsl(var(--border) / 0.62)"
              />
            )}
            <text
              x={x(round.roundNumber)}
              y={height - 14}
              textAnchor="middle"
              fontSize={compact ? 9 : expanded ? 11 : 10}
              fontWeight="900"
              fill={round.hasPublishedResults ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"}
            >
              R{round.roundNumber}
            </text>
            {!compact && !round.hasPublishedResults && (metric === "rank" || innerWidth / Math.max(1, rounds.length - 1) >= 60) ? (
              <text x={x(round.roundNumber)} y={plot.top + 1} textAnchor="middle" fontSize={expanded ? 9 : 8} fontWeight="800" fill="hsl(var(--muted-foreground))">
                {finishedWithoutPublishedResults
                  ? t("league.rank.finished")
                  : visibleHistory.some((series) => series.points.some((point) => point.round === round.roundNumber && point.projected))
                  ? t("league.rank.projectedUpper")
                  : t("league.rank.waiting")}
              </text>
            ) : null}
          </g>
        );
      })}

      {visibleHistory.map((series, seriesIndex) => {
        const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length]!;
        const isSelected = highlightedSlug === series.athleteSlug;
        const opacity = highlightedSlug ? (isSelected ? 1 : 0.28) : 0.78;
        return (
          <g key={series.athleteSlug} opacity={opacity}>
            {series.points.slice(1).map((point, pointIndex) => {
              const previous = series.points[pointIndex]!;
              const middle = (x(previous.round) + x(point.round)) / 2;
              const skipsPendingRound = point.round - previous.round > 1;
              return (
                <path
                  key={`${series.athleteSlug}-${previous.round}-${point.round}`}
                  d={`M ${x(previous.round)} ${pointY(previous)} C ${middle} ${pointY(previous)} ${middle} ${pointY(point)} ${x(point.round)} ${pointY(point)}`}
                  data-athlete-rank-curve={series.athleteSlug}
                  fill="none"
                  stroke={color}
                  strokeWidth={isSelected ? 3.6 : 2.1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={point.projected || skipsPendingRound ? "5 5" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {series.points.map((point) => {
              const pointId = `${series.athleteSlug}-${point.round}`;
              const isActive = activePoint?.id === pointId;
              const tooltipDatum: InteractiveChartTooltipDatum & { athleteSlug: string } = {
                id: pointId,
                athleteSlug: series.athleteSlug,
                eyebrow: point.projected
                  ? t("league.rank.roundProjected", { round: point.round })
                  : t("league.rank.round", { round: point.round }),
                title: series.name,
                details: [
                  { label: t("league.rank.rank"), value: `#${point.rank}` },
                  ...(metric === "rank" ? [] : [{ label: metricLabel, value: formatValue(point.points) }]),
                ],
                xPercent: x(point.round) / width * 100,
                yPercent: pointY(point) / height * 100,
                color,
              };
              const activate = () => setActivePoint(tooltipDatum);
              return (
              <g
                key={pointId}
                role="button"
                tabIndex={0}
                focusable="true"
                aria-label={pointLabel(series, point)}
                aria-describedby={isActive ? tooltipId : undefined}
                onMouseEnter={activate}
                onMouseLeave={() => setActivePoint((current) => current?.id === pointId ? null : current)}
                onFocus={activate}
                onBlur={() => setActivePoint((current) => current?.id === pointId ? null : current)}
                onClick={() => {
                  activate();
                  onSelectedSlugChange(series.athleteSlug);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setActivePoint(null);
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate();
                    onSelectedSlugChange(series.athleteSlug);
                  }
                }}
                className="cursor-pointer focus:outline-none"
              >
                <circle cx={x(point.round)} cy={pointY(point)} r={compact ? 12 : 11.5} fill="transparent" />
                {isActive ? (
                  <circle
                    cx={x(point.round)}
                    cy={pointY(point)}
                    r={compact ? 11 : 12}
                    fill={`${color}`}
                    fillOpacity="0.14"
                    stroke={color}
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                ) : null}
                <circle
                  cx={x(point.round)}
                  cy={pointY(point)}
                  data-athlete-rank-marker={series.athleteSlug}
                  r={compact ? 7.5 : 8.5}
                  fill="hsl(var(--card))"
                  stroke={color}
                  strokeWidth={isSelected ? 3 : 2}
                  strokeDasharray={point.projected ? "3 2" : undefined}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
                <text
                  x={x(point.round)}
                  y={pointY(point) + 3.2}
                  textAnchor="middle"
                  fontSize={compact ? 7 : expanded ? 9 : 8}
                  fontWeight="900"
                  fill={color}
                  pointerEvents="none"
                >
                  {point.rank}
                </text>
              </g>
              );
            })}
          </g>
        );
      })}

      {takeover ? (
        <g>
          <rect
            x={Math.max(plot.left, Math.min(width - plot.right - (compact ? 74 : 118), x(takeover.roundNumber) - (compact ? 37 : 59)))}
            y="5"
            width={compact ? 74 : 118}
            height={compact ? 20 : 23}
            rx="11"
            fill="hsl(var(--primary))"
          />
          <text
            x={Math.max(plot.left + (compact ? 37 : 59), Math.min(width - plot.right - (compact ? 37 : 59), x(takeover.roundNumber)))}
            y={compact ? 18.5 : 20}
            textAnchor="middle"
            fontSize={compact ? 7 : expanded ? 9.5 : 8.5}
            fontWeight="900"
            fill="hsl(var(--primary-foreground))"
          >
            {compact
              ? t("league.rank.takeover")
              : t("league.stats.leadChangesAt", { round: takeover.roundNumber })}
          </text>
        </g>
      ) : null}
      </svg>
      <InteractiveChartTooltip id={tooltipId} datum={activePoint} />
    </div>
    </div>
  );
}

export function LeagueRankRace({
  history,
  rounds,
  takeover,
  selectedSlug,
  onSelectedSlugChange,
  stacked = false,
  showTable = true,
  compactChart = false,
  expandedChart = false,
  metric = "rank",
}: {
  history: LeagueRankHistory[];
  rounds: LeagueRoundInsight[];
  takeover: LeagueLeaderTakeover | null;
  selectedSlug: string;
  onSelectedSlugChange: (slug: string) => void;
  stacked?: boolean;
  showTable?: boolean;
  compactChart?: boolean;
  expandedChart?: boolean;
  metric?: LeagueChartMetric;
}) {
  const { formatNumber, t } = useI18n();
  const tableRows = history
    .map((series) => ({
      series,
      last: [...series.points].reverse().find((point) => !point.projected) ?? series.points.at(-1),
    }))
    .filter((row): row is { series: LeagueRankHistory; last: LeagueRankHistoryPoint } => Boolean(row.last))
    .sort((left, right) => left.last.rank - right.last.rank || left.series.finalRank - right.series.finalRank)
    .slice(0, TOP_RANK_LIMIT);

  return (
    <div className={stacked || !showTable ? "mt-5 w-full min-w-0" : "mt-5 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_13.5rem] lg:items-start"}>
      <div className="min-w-0">
        {compactChart ? (
          <RankRaceSvg history={history} rounds={rounds} takeover={takeover} selectedSlug={selectedSlug} onSelectedSlugChange={onSelectedSlugChange} compact expanded={false} metric={metric} />
        ) : (
          <>
            <div className="sm:hidden">
              <RankRaceSvg history={history} rounds={rounds} takeover={takeover} selectedSlug={selectedSlug} onSelectedSlugChange={onSelectedSlugChange} compact expanded={false} metric={metric} />
            </div>
            <div className="hidden sm:block">
              <RankRaceSvg history={history} rounds={rounds} takeover={takeover} selectedSlug={selectedSlug} onSelectedSlugChange={onSelectedSlugChange} compact={false} expanded={expandedChart} metric={metric} />
            </div>
          </>
        )}
      </div>
      {showTable ? (
      <div className={`overflow-hidden rounded-xl border border-border/80 bg-background/55 ${stacked ? "mt-4" : ""}`}>
        <table className="w-full border-collapse text-xs" aria-label={t("league.rank.tableAria")}>
          <thead>
            <tr className="border-b border-border/70 text-[0.58rem] font-black uppercase tracking-[0.12em] text-muted-foreground">
              <th className="w-9 px-2 py-2 text-left">{t("league.rank.rank")}</th>
              <th className="px-2 py-2 text-left">{t("league.rank.name")}</th>
            </tr>
          </thead>
          <tbody>
        {tableRows.map(({ series, last }) => {
          const selected = selectedSlug === series.athleteSlug;
          return (
            <tr
              key={series.athleteSlug}
              className={`border-b border-border/60 last:border-b-0 ${selected ? "bg-primary/[0.065]" : ""}`}
            >
              <td className="px-2 py-1.5 font-display font-black tabular-nums">{last.rank}</td>
              <td className="min-w-0 px-2 py-1.5">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectedSlugChange(series.athleteSlug)}
                  onFocus={() => onSelectedSlugChange(series.athleteSlug)}
                  className="block max-w-[8.5rem] truncate text-left font-bold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {series.name}
                  {metric !== "rank" ? (
                    <span className="mt-0.5 block text-[10px] font-medium tabular-nums text-muted-foreground">
                      {t(METRIC_LABELS[metric])}: {metric === "best_time" ? formatLeagueChartTime(last.points) : formatNumber(last.points)}
                    </span>
                  ) : null}
                </button>
              </td>
            </tr>
          );
        })}
          </tbody>
        </table>
      </div>
      ) : null}
    </div>
  );
}

export function RaceAgeHeatmap({ cells }: { cells: LeagueRaceAgeCell[] }) {
  const { locale, t } = useI18n();
  const ageCategories = ["Under 18", "18–34", "35–44", "45–54", "55–64", "65+"];
  const raceCategories = Array.from(new Map(cells.map((cell) => [cell.raceCategoryId, cell.raceCategoryLabel])).entries());
  const maximum = Math.max(1, ...cells.map((cell) => cell.points));

  if (!raceCategories.length) {
    return <p className="px-5 py-8 text-sm text-muted-foreground">{t("league.stats.heatmapPending")}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-sm" aria-label={t("league.stats.heatmapAria")}>
        <thead>
          <tr className="border-b border-border/70 text-[0.62rem] font-black uppercase tracking-[0.1em] text-muted-foreground">
            <th className="w-32 px-3 py-3 text-left">{t("league.stats.raceCategory")}</th>
            {ageCategories.map((category) => <th key={category} className="px-2 py-3 text-center">{localizedLeagueDataLabel(category, locale)}</th>)}
          </tr>
        </thead>
        <tbody>
          {raceCategories.map(([raceCategoryId, raceCategoryLabel]) => (
            <tr key={raceCategoryId} className="border-b border-border/60 last:border-b-0">
              <th className="px-3 py-4 text-left font-display font-black">{localizedLeagueDataLabel(raceCategoryLabel, locale)}</th>
              {ageCategories.map((ageCategory) => {
                const cell = cells.find((item) => item.raceCategoryId === raceCategoryId && item.ageCategory === ageCategory);
                const points = cell?.points ?? 0;
                const intensity = points ? 0.12 + points / maximum * 0.7 : 0.035;
                return (
                  <td key={ageCategory} className="border-l border-border/55 p-1.5 text-center">
                    <span
                      className="flex min-h-14 flex-col items-center justify-center rounded-lg font-display font-black tabular-nums"
                      style={{ backgroundColor: `hsl(var(--trail-green) / ${intensity})`, color: intensity > 0.54 ? "white" : "hsl(var(--foreground))" }}
                      title={t("league.stats.heatmapCell", {
                        race: localizedLeagueDataLabel(raceCategoryLabel, locale),
                        age: localizedLeagueDataLabel(ageCategory, locale),
                        points,
                        athletes: cell?.athletes ?? 0,
                      })}
                    >
                      {points || "—"}
                      {points ? <span className="mt-0.5 text-[0.55rem] font-bold uppercase tracking-[0.08em] opacity-80">{t("league.stats.pointsShort")}</span> : null}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DistanceClassBars({ categories }: { categories: LeagueDistanceCategoryInsight[] }) {
  const { locale, t } = useI18n();
  const standardCategories = categories.filter((category) => !["below-minimum", "unknown"].includes(category.id));
  const total = standardCategories.reduce((sum, category) => sum + category.entries, 0);
  const maximum = Math.max(1, ...standardCategories.map((category) => category.entries));

  return (
    <div className="mt-5 space-y-3" role="img" aria-label={t("league.stats.distanceAria")}>
      {standardCategories.map((category) => {
        const percent = total ? Math.round(category.entries / total * 100) : 0;
        return (
          <div key={category.id} className="grid grid-cols-[minmax(7rem,0.85fr)_minmax(7rem,1.4fr)_3rem] items-center gap-3 text-xs">
            <div className="min-w-0">
              <div className="truncate font-black">{category.label.split(" · ").map((part, index) => index === 0 ? localizedLeagueDataLabel(part, locale) : part).join(" ")}</div>
              <div className="mt-0.5 text-[0.62rem] font-bold text-muted-foreground">{t("league.stats.athletesCount", { count: category.athletes })}</div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${category.entries ? Math.max(4, category.entries / maximum * 100) : 0}%`,
                  backgroundColor: DISTANCE_COLORS[category.id] ?? "hsl(var(--muted-foreground))",
                }}
              />
            </div>
            <div className="text-right font-display font-black tabular-nums">{percent}%</div>
          </div>
        );
      })}
    </div>
  );
}

export function AthleteParticipationBars({ athletes }: { athletes: LeagueAthleteParticipation[] }) {
  const { formatNumber, t } = useI18n();
  const tooltipId = useId();
  const visible = athletes.slice(0, 50);
  const maximum = Math.max(1, ...visible.map((athlete) => athlete.entries));
  const [activeColumn, setActiveColumn] = useState<InteractiveChartTooltipDatum | null>(null);
  const middle = Math.ceil(maximum / 2);

  if (!visible.length) {
    return <p className="mt-5 text-sm text-muted-foreground">{t("league.stats.countingSlotsPending")}</p>;
  }

  return (
    <div className="relative mt-5" data-athlete-participation-chart>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.6rem] font-black uppercase tracking-[0.08em] text-muted-foreground" aria-label={t("league.stats.participations")}>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--trail-green))]" aria-hidden="true" />{t("league.stats.finished")}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-destructive" aria-hidden="true" />{t("league.results.dnf")}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--trail-amber))]" aria-hidden="true" />{t("league.results.dns")}</span>
      </div>
      <div
        className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-2"
        role="group"
        aria-label={visible.map((athlete) => `${athlete.name}: ${formatNumber(athlete.entries)} ${t("league.stats.entered")}, ${formatNumber(athlete.finishes)} ${t("league.stats.finished")}, ${formatNumber(athlete.didNotFinish)} ${t("league.results.dnf")}, ${formatNumber(athlete.didNotStart)} ${t("league.results.dns")}`).join("; ")}
      >
        <div className="relative h-72 pt-6 text-right text-[0.58rem] font-black tabular-nums text-muted-foreground" aria-hidden="true">
          <span className="absolute right-0 top-5">{formatNumber(maximum)}</span>
          <span className="absolute right-0 top-[calc(50%+0.75rem)] -translate-y-1/2">{formatNumber(middle)}</span>
          <span className="absolute bottom-0 right-0">0</span>
        </div>
        <div className="min-w-0">
          <div className="relative h-72 pt-6">
            <span className="absolute inset-x-0 top-6 border-t border-dashed border-border" aria-hidden="true" />
            <span className="absolute inset-x-0 top-[calc(50%+0.75rem)] border-t border-dashed border-border" aria-hidden="true" />
            <span className="absolute inset-x-0 bottom-0 border-t border-border" aria-hidden="true" />
            <div
              className="absolute inset-x-0 bottom-0 top-6 grid gap-px"
              style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
            >
              {visible.map((athlete, index) => {
                const height = athlete.entries / maximum * 100;
                const datum: InteractiveChartTooltipDatum = {
                  id: athlete.athleteSlug,
                  eyebrow: athlete.club || t("league.stats.athletesLabel"),
                  title: athlete.name,
                  details: [
                    { label: t("league.stats.entered"), value: formatNumber(athlete.entries) },
                    { label: t("league.stats.finished"), value: formatNumber(athlete.finishes) },
                    { label: t("league.results.dnf"), value: formatNumber(athlete.didNotFinish) },
                    { label: t("league.results.dns"), value: formatNumber(athlete.didNotStart) },
                  ],
                  xPercent: (index + 0.5) / visible.length * 100,
                  yPercent: 100 - height * 0.92,
                  color: "hsl(var(--primary))",
                };
                const active = activeColumn?.id === athlete.athleteSlug;
                const activate = () => setActiveColumn(datum);
                return (
                  <button
                    key={athlete.athleteSlug}
                    type="button"
                    aria-describedby={active ? tooltipId : undefined}
                    aria-label={`${athlete.name}: ${formatNumber(athlete.entries)} ${t("league.stats.entered")}, ${formatNumber(athlete.finishes)} ${t("league.stats.finished")}, ${formatNumber(athlete.didNotFinish)} ${t("league.results.dnf")}, ${formatNumber(athlete.didNotStart)} ${t("league.results.dns")}`}
                    onMouseEnter={activate}
                    onMouseLeave={() => setActiveColumn((current) => current?.id === athlete.athleteSlug ? null : current)}
                    onFocus={activate}
                    onBlur={() => setActiveColumn((current) => current?.id === athlete.athleteSlug ? null : current)}
                    onClick={activate}
                    data-athlete-participation-column
                    className="group relative flex h-full min-w-0 items-end justify-center focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="flex w-full min-w-px flex-col-reverse overflow-hidden rounded-t-[2px] bg-muted" style={{ height: `${height}%` }} aria-hidden="true">
                      <span data-athlete-outcome="finished" className="block w-full bg-[hsl(var(--trail-green))] transition-[filter] group-hover:brightness-110 group-focus-visible:brightness-110" style={{ height: `${athlete.entries ? athlete.finishes / athlete.entries * 100 : 0}%` }} />
                      <span data-athlete-outcome="dnf" className="block w-full bg-destructive transition-[filter] group-hover:brightness-110 group-focus-visible:brightness-110" style={{ height: `${athlete.entries ? athlete.didNotFinish / athlete.entries * 100 : 0}%` }} />
                      <span data-athlete-outcome="dns" className="block w-full bg-[hsl(var(--trail-amber))] transition-[filter] group-hover:brightness-110 group-focus-visible:brightness-110" style={{ height: `${athlete.entries ? athlete.didNotStart / athlete.entries * 100 : 0}%` }} />
                    </span>
                    <span
                      className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 whitespace-nowrap font-display text-[0.5rem] font-black tabular-nums text-foreground sm:block"
                      style={{ bottom: `calc(${height}% + 2px)` }}
                      aria-hidden="true"
                    >
                      {formatNumber(athlete.entries)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-2 grid text-center text-[0.54rem] font-black tabular-nums text-muted-foreground" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }} aria-hidden="true">
            {visible.map((athlete, index) => <span key={athlete.athleteSlug}>{index === 0 || (index + 1) % 10 === 0 || index === visible.length - 1 ? index + 1 : ""}</span>)}
          </div>
        </div>
      </div>
      <InteractiveChartTooltip id={tooltipId} datum={activeColumn} />
    </div>
  );
}

type CompactDonutItem = {
  id: string;
  label: string;
  value: number;
  color: string;
};

function CompactDonutDistribution({
  items,
  centerLabel,
}: {
  items: CompactDonutItem[];
  centerLabel: string;
}) {
  const { formatNumber } = useI18n();
  const visible = items.filter((item) => item.value > 0);
  const total = visible.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="mt-4 flex flex-1 flex-col" data-compact-donut>
      <div className="mx-auto w-full max-w-[8.75rem]">
        <DistributionDonut
          segments={visible.map(({ label, value, color }) => ({ label, value, color }))}
          centerValue={formatNumber(total)}
          centerLabel={centerLabel}
        />
      </div>
      <div className="mt-4 grid gap-1.5">
        {visible.map((item) => (
          <div key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-[0.65rem] leading-4">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
            <span className="truncate font-bold text-muted-foreground" title={item.label}>{item.label}</span>
            <span className="whitespace-nowrap font-black tabular-nums">{formatNumber(item.value)} <span className="text-[0.55rem] text-muted-foreground">· {total ? Math.round(item.value / total * 100) : 0}%</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CompetitionParticipationDonut({ groups }: { groups: LeagueCompetitionParticipation[] }) {
  const { locale, t } = useI18n();

  if (!groups.length) {
    return <p className="mt-5 text-sm text-muted-foreground">{t("league.stats.noRegistrationData")}</p>;
  }

  return (
    <CompactDonutDistribution
      items={groups.map((group, index) => ({
        id: group.id,
        label: localizedLeagueDataLabel(group.label, locale),
        value: group.registrations,
        color: SERIES_COLORS[index % SERIES_COLORS.length]!,
      }))}
      centerLabel={t("league.stats.entered")}
    />
  );
}

export function RoundPulseCard({ round }: { round: LeagueRoundInsight }) {
  const { t } = useI18n();
  if (!round.hasPublishedResults) {
    const completed = round.status === "completed";
    return (
      <article className={`flex min-h-[8.5rem] flex-col justify-between rounded-[1.35rem] border p-4 ${
        completed
          ? "border-trail-green/45 bg-trail-green/[0.06]"
          : "border-dashed border-muted-foreground/45 bg-muted/[0.12]"
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div><p className="font-display text-lg font-black">R{round.roundNumber}</p><p className="mt-0.5 text-xs font-bold">{round.label}</p></div>
          <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[0.58rem] font-black uppercase tracking-[0.08em] text-muted-foreground">
            {t(completed ? "league.stats.roundFinished" : "league.stats.waiting")}
          </span>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {completed
            ? t(round.registrations > 0
              ? "league.stats.finishedPendingResults"
              : "league.stats.finishedNoRegistrations")
            : round.registrations > 0
            ? t("league.stats.registeredPending", { count: round.registrations })
            : t("league.stats.roundWaiting")}
        </p>
      </article>
    );
  }

  const total = Math.max(1, round.registrations);
  const finishedShare = round.finishers / total * 100;
  const unfinishedShare = round.startedNotFinished / total * 100;
  const didNotStartShare = Math.max(0, 100 - finishedShare - unfinishedShare);
  return (
    <article className="rounded-[1.35rem] border border-border/80 bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-display text-lg font-black">R{round.roundNumber}</p><p className="mt-0.5 max-w-[9rem] truncate text-xs font-bold">{round.label}</p></div>
        <span className="text-right text-[0.62rem] font-black text-muted-foreground">{round.registrations}<span className="block font-semibold">{t("league.stats.entered")}</span></span>
      </div>
      <div
        className="mt-5 flex h-4 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={t("league.stats.roundPulseAria", {
          round: round.roundNumber,
          finished: round.finishers,
          dnf: round.startedNotFinished,
          dns: round.didNotStart,
        })}
      >
        <span className="h-full bg-[hsl(var(--trail-green))]" style={{ width: `${finishedShare}%` }} aria-hidden="true" />
        <span className="h-full bg-[hsl(var(--trail-green))]/45" style={{ width: `${unfinishedShare}%` }} aria-hidden="true" />
        <span className="h-full bg-muted-foreground/20" style={{ width: `${didNotStartShare}%` }} aria-hidden="true" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <p><strong className="font-display text-base font-black text-[hsl(var(--trail-green))]">{round.finishers}</strong><span className="block text-[0.6rem] text-muted-foreground">{t("league.stats.finished")}</span></p>
        <p className="text-right"><strong className="font-display text-base font-black">{round.starters}</strong><span className="block text-[0.6rem] text-muted-foreground">{t("league.stats.started")}</span></p>
      </div>
    </article>
  );
}

export function AgeShape({ groups }: { groups: Array<{ label: string; count: number }> }) {
  const { locale, t } = useI18n();
  return (
    <CompactDonutDistribution
      items={groups.map((group, index) => ({
        id: group.label,
        label: group.label === "Not specified" ? t("common.notSpecified") : localizedLeagueDataLabel(group.label, locale),
        value: group.count,
        color: DEMOGRAPHIC_COLORS[group.label] ?? SERIES_COLORS[index % SERIES_COLORS.length]!,
      }))}
      centerLabel={t("league.stats.athletesLabel")}
    />
  );
}

export function CountryRing({ groups }: { groups: LeagueDemographicItem[] }) {
  const { localeTag, t } = useI18n();
  const labelFor = (label: string) => label === "Not specified"
    ? t("common.notSpecified")
    : localizedCountryName(label, localeTag, label);
  const visible = groups.slice(0, 7);
  const remaining = groups.slice(7);
  const data = [
    ...visible,
    ...(remaining.length ? [{
      label: t("league.stats.otherCountries", { count: remaining.length }),
      count: remaining.reduce((sum, group) => sum + group.count, 0),
      percent: remaining.reduce((sum, group) => sum + group.percent, 0),
    }] : []),
  ];
  return (
    <CompactDonutDistribution
      items={data.map((group, index) => ({
        id: group.label,
        label: labelFor(group.label),
        value: group.count,
        color: SERIES_COLORS[index % SERIES_COLORS.length]!,
      }))}
      centerLabel={t("league.stats.athletesLabel")}
    />
  );
}

export function CourseAgeRings({ courses }: { courses: LeagueCourseAgeDistribution[] }) {
  const { locale, t } = useI18n();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {courses.map((course) => {
        const groups = course.groups.filter((group) => group.count > 0);
        return <figure key={course.id} className="flex min-w-0 flex-col rounded-2xl border border-border bg-background/55 p-4">
          <figcaption className="truncate text-xs font-black uppercase tracking-[0.12em] text-muted-foreground">{localizedLeagueDataLabel(course.label, locale)}</figcaption>
          <CompactDonutDistribution
            items={groups.map((group, index) => ({
              id: group.label,
              label: group.label === "Not specified" ? t("common.notSpecified") : localizedLeagueDataLabel(group.label, locale),
              value: group.count,
              color: DEMOGRAPHIC_COLORS[group.label] ?? SERIES_COLORS[index % SERIES_COLORS.length]!,
            }))}
            centerLabel={t("league.stats.athletesLabel")}
          />
        </figure>;
      })}
    </div>
  );
}

export function ClubRegistrationBars({ clubs }: { clubs: LeagueClubPresence[] }) {
  const { formatNumber, t } = useI18n();
  const tooltipId = useId();
  const data = clubs.slice(0, 50);
  const maximum = Math.max(1, ...data.map((club) => club.entries));
  const middle = Math.ceil(maximum / 2);
  const [activeColumn, setActiveColumn] = useState<InteractiveChartTooltipDatum | null>(null);

  if (!data.length) {
    return <p className="mt-5 text-sm text-muted-foreground">{t("league.stats.clubPresencePending")}</p>;
  }

  return (
    <div className="relative mt-5" data-club-registration-chart>
      <div
        className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-2"
        role="group"
        aria-label={data.map((club) => `${club.name}: ${t("league.stats.registrationCount", { count: club.entries })}, ${t("league.stats.uniqueAthletes", { count: club.athletes })}`).join("; ")}
      >
        <div className="relative h-80 pt-6 text-right text-[0.58rem] font-black tabular-nums text-muted-foreground" aria-hidden="true">
          <span className="absolute right-0 top-5">{formatNumber(maximum)}</span>
          <span className="absolute right-0 top-[calc(50%+0.75rem)] -translate-y-1/2">{formatNumber(middle)}</span>
          <span className="absolute bottom-0 right-0">0</span>
        </div>
        <div className="min-w-0">
          <div className="relative h-80 pt-6">
            <span className="absolute inset-x-0 top-6 border-t border-dashed border-border" aria-hidden="true" />
            <span className="absolute inset-x-0 top-[calc(50%+0.75rem)] border-t border-dashed border-border" aria-hidden="true" />
            <span className="absolute inset-x-0 bottom-0 border-t border-border" aria-hidden="true" />
            <div className="absolute inset-x-0 bottom-0 top-6 grid gap-px" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
              {data.map((club, index) => {
                const height = club.entries / maximum * 100;
                const datum: InteractiveChartTooltipDatum = {
                  id: club.slug || `${club.name}-${index}`,
                  eyebrow: t("league.stats.clubParticipation"),
                  title: club.name,
                  details: [
                    { label: t("league.stats.entered"), value: formatNumber(club.entries) },
                    { label: t("league.stats.athletesLabel"), value: formatNumber(club.athletes) },
                    ...club.rounds.map((round) => ({ label: `R${round.roundNumber}`, value: formatNumber(round.entries) })),
                  ],
                  xPercent: (index + 0.5) / data.length * 100,
                  yPercent: 100 - height * 0.92,
                  color: "hsl(var(--trail-green))",
                };
                const active = activeColumn?.id === datum.id;
                const activate = () => setActiveColumn(datum);
                return (
                  <button
                    key={`${club.name}-${index}`}
                    type="button"
                    aria-describedby={active ? tooltipId : undefined}
                    aria-label={`${club.name}: ${t("league.stats.registrationCount", { count: club.entries })}, ${t("league.stats.uniqueAthletes", { count: club.athletes })}`}
                    onMouseEnter={activate}
                    onMouseLeave={() => setActiveColumn((current) => current?.id === datum.id ? null : current)}
                    onFocus={activate}
                    onBlur={() => setActiveColumn((current) => current?.id === datum.id ? null : current)}
                    onClick={activate}
                    data-club-registration-column
                    className="group relative flex h-full min-w-0 items-end justify-center focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="flex w-full min-w-px flex-col-reverse overflow-hidden rounded-t-[2px] bg-muted" style={{ height: `${height}%` }} aria-hidden="true">
                      {club.rounds.map((round) => (
                        <span
                          key={round.roundNumber}
                          className="block w-full transition-[filter] group-hover:brightness-110 group-focus-visible:brightness-110"
                          style={{ height: `${round.entries / club.entries * 100}%`, backgroundColor: SERIES_COLORS[(round.roundNumber - 1) % SERIES_COLORS.length] }}
                        />
                      ))}
                    </span>
                    <span
                      className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 whitespace-nowrap font-display text-[0.5rem] font-black tabular-nums text-foreground sm:block"
                      style={{ bottom: `calc(${height}% + 2px)` }}
                      aria-hidden="true"
                    >
                      {formatNumber(club.entries)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-2 grid text-center text-[0.54rem] font-black tabular-nums text-muted-foreground" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }} aria-hidden="true">
            {data.map((club, index) => <span key={`${club.name}-${index}`}>{index === 0 || (index + 1) % 10 === 0 || index === data.length - 1 ? index + 1 : ""}</span>)}
          </div>
        </div>
      </div>
      <InteractiveChartTooltip id={tooltipId} datum={activeColumn} />
    </div>
  );
}

export function GenderRing({ groups }: { groups: Array<{ label: string; count: number; percent: number }> }) {
  const { locale, t } = useI18n();
  const colorFor = (label: string) => label === "Female"
    ? "hsl(var(--primary))"
    : label === "Male"
      ? "hsl(var(--trail-green))"
      : "hsl(var(--muted-foreground))";
  return (
    <CompactDonutDistribution
      items={groups.map((group) => ({
        id: group.label,
        label: group.label === "Not specified" ? t("common.notSpecified") : localizedLeagueDataLabel(group.label, locale),
        value: group.count,
        color: colorFor(group.label),
      }))}
      centerLabel={t("league.stats.athletesLabel")}
    />
  );
}
