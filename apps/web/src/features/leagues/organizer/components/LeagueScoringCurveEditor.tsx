import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { Input } from "@/components/ui/input";
import {
  buildLeagueScoringCurve,
  leagueHybridEmphasisOptions,
  type LeagueHybridEmphasis,
} from "@/features/leagues/organizer/model/leagueScoringCurve";
import { useI18n } from "@/shared/i18n/I18nContext";

type LeagueScoringCurveEditorProps = {
  method: "geometric" | "hybrid";
  maximumPoints: string;
  expectedFinishers: string;
  participationPoints: string;
  hybridEmphasis: LeagueHybridEmphasis;
  onChange: (patch: Partial<{
    maximumPoints: string;
    expectedFinishers: string;
    participationPoints: string;
    hybridEmphasis: LeagueHybridEmphasis;
  }>) => void;
};

type LeagueScoringChartDatum = {
  place: number;
  points: number;
  geometric?: number;
};

type LeagueScoringTooltipProps = Pick<TooltipProps<number, string>, "active" | "payload"> & {
  scoringLabel: string;
  showGeometricBaseline: boolean;
};

type LeaguePointsCurveChartProps = {
  points: number[];
  geometricPoints?: number[];
  scoringLabel: string;
  ariaLabel: string;
  className?: string;
  showGeometricBaseline?: boolean;
};

function safeInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function LeagueScoringTooltip({
  active,
  payload,
  scoringLabel,
  showGeometricBaseline,
}: LeagueScoringTooltipProps) {
  const { t } = useI18n();
  const datum = payload?.[0]?.payload as LeagueScoringChartDatum | undefined;

  if (!active || !datum) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="min-w-44 rounded-xl border border-primary/25 bg-popover/95 px-3 py-2.5 text-popover-foreground shadow-xl backdrop-blur-sm"
    >
      <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Overall finish place</div>
      <div className="mt-0.5 text-lg font-bold">#{datum.place}</div>
      <dl className="mt-2 space-y-1.5 border-t border-border/70 pt-2 text-xs">
        <div className="flex items-center justify-between gap-5">
          <dt className="text-muted-foreground">{scoringLabel}</dt>
          <dd className="font-semibold tabular-nums">{t("organizer.league.pointsShort", { points: datum.points })}</dd>
        </div>
        {showGeometricBaseline && datum.geometric != null ? (
          <div className="flex items-center justify-between gap-5">
            <dt className="text-muted-foreground">Geometric baseline</dt>
            <dd className="font-semibold tabular-nums">{t("organizer.league.pointsShort", { points: datum.geometric })}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

export function LeaguePointsCurveChart({
  points,
  geometricPoints,
  scoringLabel,
  ariaLabel,
  className = "h-48",
  showGeometricBaseline = false,
}: LeaguePointsCurveChartProps) {
  const chartData = useMemo(() => points.map((score, index) => ({
    place: index + 1,
    points: score,
    geometric: geometricPoints?.[index],
  })), [geometricPoints, points]);

  return (
    <div className={`${className} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 12, right: 4, bottom: 8, left: 0 }}
          accessibilityLayer
          aria-label={ariaLabel}
        >
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="place"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "hsl(var(--border))" }}
            minTickGap={28}
          />
          <YAxis
            width={40}
            domain={[0, "dataMax"]}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip<number, string>
            accessibilityLayer
            content={(
              <LeagueScoringTooltip
                scoringLabel={scoringLabel}
                showGeometricBaseline={showGeometricBaseline}
              />
            )}
            cursor={{ stroke: "hsl(var(--primary))", strokeDasharray: "3 3", strokeWidth: 1.5 }}
            isAnimationActive={false}
            offset={10}
            wrapperStyle={{ outline: "none", zIndex: 20 }}
          />
          {showGeometricBaseline ? (
            <Line
              type="monotone"
              dataKey="geometric"
              name="Geometric baseline"
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="points"
            name={scoringLabel}
            stroke="hsl(var(--primary))"
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 5, stroke: "hsl(var(--background))", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LeagueScoringCurveEditor({
  method,
  maximumPoints,
  expectedFinishers,
  participationPoints,
  hybridEmphasis,
  onChange,
}: LeagueScoringCurveEditorProps) {
  const { locale, t } = useI18n();
  const curve = useMemo(() => buildLeagueScoringCurve({
    method,
    maximumPoints: safeInteger(maximumPoints, 100),
    expectedFinishers: safeInteger(expectedFinishers, 100),
    finisherPoints: safeInteger(participationPoints, 5),
    hybridEmphasis,
  }), [expectedFinishers, hybridEmphasis, maximumPoints, method, participationPoints]);
  const midpointIndex = Math.floor((curve.points.length - 1) / 2);
  const summary = [
    { label: locale === "hr" ? "Pobjednik" : "Winner", place: 1, points: curve.points[0] ?? 0 },
    { label: locale === "hr" ? "Sredina poretka" : "Mid-pack", place: midpointIndex + 1, points: curve.points[midpointIndex] ?? 0 },
    { label: locale === "hr" ? "Posljednji planirani finišer" : "Last planned finisher", place: curve.points.length, points: curve.points.at(-1) ?? 0 },
  ];
  const chartAriaLabel = locale === "hr"
    ? `${method === "hybrid" ? "Hibridna" : "Geometrijska"} krivulja bodovanja: prvo mjesto dobiva ${summary[0].points} bodova, ${summary[1].place}. mjesto dobiva ${summary[1].points} bodova, a ${summary[2].place}. mjesto dobiva ${summary[2].points} bodova. Fokusirajte grafikon i koristite lijevu i desnu strelicu za pregled svakog mjesta.`
    : `${method === "hybrid" ? "Hybrid" : "Geometric"} scoring curve: first place receives ${summary[0].points} points, place ${summary[1].place} receives ${summary[1].points} points, and place ${summary[2].place} receives ${summary[2].points} points. Focus the chart and use the left and right arrow keys to inspect every place.`;

  return (
    <div className="grid gap-2.5 xl:grid-cols-2 xl:items-start">
      <figure className="min-w-0 rounded-xl border border-border/70 bg-background/75 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <figcaption className="text-sm font-semibold">Points distribution</figcaption>
          <div className="flex flex-wrap items-center gap-1.5">
            {summary.map((item) => (
              <span key={item.label} className="rounded-full border border-border/70 bg-card px-2.5 py-1 text-[10px] font-semibold">
                {item.label} #{item.place} · {t("organizer.league.pointsShort", { points: item.points })}
              </span>
            ))}
            <span className="rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-primary">
              Live
            </span>
          </div>
        </div>

        <LeaguePointsCurveChart
          points={curve.points}
          geometricPoints={curve.geometricPoints}
          scoringLabel={method === "hybrid"
            ? (locale === "hr" ? "Hibridni bodovi" : "Hybrid score")
            : (locale === "hr" ? "Geometrijski bodovi" : "Geometric score")}
          ariaLabel={chartAriaLabel}
          className="mt-1.5 h-48"
          showGeometricBaseline={method === "hybrid"}
        />
      </figure>

      <div className="grid gap-2 sm:grid-cols-2 xl:content-start">
        <label className="block space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Winner points</span>
          <Input
            type="number"
            min="2"
            max="10000"
            value={maximumPoints}
            onChange={(event) => onChange({ maximumPoints: event.target.value })}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Expected finishers</span>
          <Input
            type="number"
            min="2"
            max="500"
            value={expectedFinishers}
            onChange={(event) => onChange({ expectedFinishers: event.target.value })}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Finisher minimum</span>
          <Input
            type="number"
            min="1"
            max="9999"
            value={participationPoints}
            onChange={(event) => onChange({ participationPoints: event.target.value })}
          />
        </label>
        {method === "hybrid" ? (
          <label className="block space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Top-finish emphasis</span>
            <select
              value={hybridEmphasis}
              onChange={(event) => onChange({ hybridEmphasis: event.target.value as LeagueHybridEmphasis })}
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {leagueHybridEmphasisOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </div>
  );
}
