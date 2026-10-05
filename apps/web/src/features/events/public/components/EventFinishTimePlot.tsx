import { useI18n } from "@/shared/i18n/I18nContext";
import { useId, useState } from "react";
import {
  InteractiveChartTooltip,
  type InteractiveChartTooltipDatum,
} from "@/shared/statistics/InteractiveChartTooltip";
import type { EventCategoryStatistics, EventFinishTime } from "../model/eventStatistics";

const COURSE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--trail-green))",
  "hsl(var(--trail-blue))",
  "#7f62b3",
];

type FinishPlotRow = {
  slug: string;
  name: string;
  startAtIso: string | null;
  finishTimes: EventFinishTime[];
};

function formatDuration(milliseconds: number, includeSeconds = false) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  return includeSeconds
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${hours}:${String(minutes).padStart(2, "0")}`;
}

function validDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatFinishValue(milliseconds: number, startAtIso: string | null, includeSeconds = false) {
  const start = validDate(startAtIso);
  if (!start) return formatDuration(milliseconds, includeSeconds);
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" as const } : {}),
    hour12: false,
    timeZone: "Europe/Zagreb",
  }).format(new Date(start.getTime() + milliseconds));
}

function medianTime(times: EventFinishTime[]) {
  if (!times.length) return 0;
  const middle = Math.floor(times.length / 2);
  return times.length % 2
    ? times[middle]!.finishTimeMs
    : (times[middle - 1]!.finishTimeMs + times[middle]!.finishTimeMs) / 2;
}

function FinishRowsSvg({ rows, compact }: { rows: FinishPlotRow[]; compact: boolean }) {
  const { t } = useI18n();
  const tooltipId = useId();
  const [activeFinisher, setActiveFinisher] = useState<InteractiveChartTooltipDatum | null>(null);
  const width = compact ? 360 : 760;
  const rowHeight = compact ? 112 : 120;
  const height = Math.max(rowHeight, rows.length * rowHeight);
  const plotLeft = compact ? 18 : 128;
  const plotRight = compact ? 18 : 18;
  const axisWidth = width - plotLeft - plotRight;
  const ariaLabel = rows.map((row) => {
    if (!row.finishTimes.length) return t("event.detail.finishPlot.rowEmpty", { race: row.name });
    const winner = row.finishTimes[0]!;
    const last = row.finishTimes.at(-1)!;
    return t("event.detail.finishPlot.row", {
      race: row.name, count: row.finishTimes.length,
      first: formatFinishValue(winner.finishTimeMs, row.startAtIso),
      median: formatFinishValue(medianTime(row.finishTimes), row.startAtIso),
      last: formatFinishValue(last.finishTimeMs, row.startAtIso),
    });
  }).join(". ");

  return (
    <div className="relative min-w-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full overflow-visible"
        role="group"
        aria-label={t("event.detail.finishPlot.aria", { summary: ariaLabel })}
      >
      {rows.map((row, rowIndex) => {
        const color = COURSE_COLORS[rowIndex % COURSE_COLORS.length]!;
        const rowTop = rowIndex * rowHeight;
        const axisY = rowTop + (compact ? 67 : 62);
        const times = row.finishTimes;
        if (!times.length) {
          return (
            <g key={row.slug}>
              <text x={compact ? plotLeft : 0} y={rowTop + 24} fill={color} fontSize="12" fontWeight="900">{row.name}</text>
              <line x1={plotLeft} x2={width - plotRight} y1={axisY} y2={axisY} stroke="hsl(var(--border))" strokeDasharray="4 5" />
              <text x={plotLeft + axisWidth / 2} y={axisY + 4} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="10" fontWeight="700">Waiting for published finish times</text>
            </g>
          );
        }

        const minimum = times[0]!.finishTimeMs;
        const maximum = times.at(-1)!.finishTimeMs;
        const extent = Math.max(1, maximum - minimum);
        const paddedMinimum = minimum - extent * 0.04;
        const paddedMaximum = maximum + extent * 0.04;
        const x = (value: number) => plotLeft + (value - paddedMinimum) / Math.max(1, paddedMaximum - paddedMinimum) * axisWidth;
        const median = medianTime(times);
        const includeSeconds = maximum - minimum < 5 * 60 * 1000;
        const winnerLabel = formatFinishValue(minimum, row.startAtIso, includeSeconds);
        const medianLabel = formatFinishValue(median, row.startAtIso, includeSeconds);
        const lastLabel = formatFinishValue(maximum, row.startAtIso, includeSeconds);

        return (
          <g key={row.slug}>
            {compact ? (
              <>
                <text x={plotLeft} y={rowTop + 19} fill={color} fontSize="12" fontWeight="900">{row.name}</text>
                <text x={width - plotRight} y={rowTop + 19} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="9" fontWeight="700">{t("event.detail.finishersCount", { count: times.length })}</text>
              </>
            ) : (
              <>
                <text x="0" y={axisY - 18} fill={color} fontSize="12" fontWeight="900">{row.name}</text>
                <text x="0" y={axisY + 1} fill="hsl(var(--muted-foreground))" fontSize="9" fontWeight="700">{t("event.detail.finishersCount", { count: times.length })}</text>
              </>
            )}

            <line x1={plotLeft} x2={width - plotRight} y1={axisY} y2={axisY} stroke="hsl(var(--muted-foreground) / 0.45)" strokeWidth="1" shapeRendering="crispEdges" />
            <line x1={x(median)} x2={x(median)} y1={axisY - 31} y2={axisY + 10} stroke="hsl(var(--foreground) / 0.72)" strokeWidth="1" shapeRendering="crispEdges" />
            <text x={x(median)} y={axisY - 38} textAnchor="middle" fill="hsl(var(--foreground))" fontSize={compact ? 8 : 9} fontWeight="900">Median {medianLabel}</text>

            {times.map((time, index) => {
              const cx = x(time.finishTimeMs);
              const lane = index % 3;
              const cy = axisY - 15 + (lane - 1) * 9;
              const previousLaneTime = times[index - 3];
              const nextLaneTime = times[index + 3];
              const hitLeft = previousLaneTime
                ? (x(previousLaneTime.finishTimeMs) + cx) / 2
                : plotLeft;
              const hitRight = nextLaneTime
                ? (cx + x(nextLaneTime.finishTimeMs)) / 2
                : width - plotRight;
              const pointId = `${row.slug}-${time.registrationId}`;
              const isActive = activeFinisher?.id === pointId;
              const exactFinish = formatFinishValue(time.finishTimeMs, row.startAtIso, true);
              const tooltipDatum: InteractiveChartTooltipDatum = {
                id: pointId,
                eyebrow: row.name,
                title: time.athleteName,
                details: [
                  { label: row.startAtIso ? "Finished" : "Elapsed", value: exactFinish },
                  { label: "Place", value: time.overall > 0 ? `#${time.overall}` : "—" },
                  ...(row.startAtIso ? [{ label: "Elapsed", value: formatDuration(time.finishTimeMs, true) }] : []),
                ],
                xPercent: cx / width * 100,
                yPercent: cy / height * 100,
                color,
              };
              const activate = () => setActiveFinisher(tooltipDatum);
              return (
                <g
                  key={time.registrationId}
                  role="button"
                  tabIndex={0}
                  focusable="true"
                  aria-label={`${time.athleteName}, ${row.name}, finished ${exactFinish}, place ${time.overall > 0 ? time.overall : "not ranked"}`}
                  aria-describedby={isActive ? tooltipId : undefined}
                  onMouseEnter={activate}
                  onMouseLeave={() => setActiveFinisher((current) => current?.id === pointId ? null : current)}
                  onFocus={activate}
                  onBlur={() => setActiveFinisher((current) => current?.id === pointId ? null : current)}
                  onClick={activate}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setActiveFinisher(null);
                  }}
                  className="cursor-pointer focus:outline-none"
                >
                  <rect
                    x={hitLeft}
                    y={cy - 4.5}
                    width={Math.max(2, hitRight - hitLeft)}
                    height="9"
                    fill="transparent"
                  />
                  {isActive ? (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={compact ? 8 : 9}
                      fill={color}
                      fillOpacity="0.14"
                      stroke={color}
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ) : null}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={compact ? 3.5 : 4}
                    fill={color}
                    stroke="hsl(var(--card))"
                    strokeWidth="1.25"
                    pointerEvents="none"
                  />
                </g>
              );
            })}

            <line x1={plotLeft} x2={plotLeft} y1={axisY - 4} y2={axisY + 5} stroke="hsl(var(--muted-foreground))" />
            <line x1={width - plotRight} x2={width - plotRight} y1={axisY - 4} y2={axisY + 5} stroke="hsl(var(--muted-foreground))" />
            <text x={plotLeft} y={axisY + 22} textAnchor="start" fill="hsl(var(--foreground))" fontSize={compact ? 8 : 9} fontWeight="900">{winnerLabel}</text>
            <text x={plotLeft} y={axisY + 35} textAnchor="start" fill="hsl(var(--muted-foreground))" fontSize="8" fontWeight="700">Winner</text>
            <text x={width - plotRight} y={axisY + 22} textAnchor="end" fill="hsl(var(--foreground))" fontSize={compact ? 8 : 9} fontWeight="900">{lastLabel}</text>
            <text x={width - plotRight} y={axisY + 35} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="8" fontWeight="700">Last finisher</text>
          </g>
        );
      })}
      </svg>
      <InteractiveChartTooltip id={tooltipId} datum={activeFinisher} />
    </div>
  );
}

export function EventFinishTimePlot({
  categories,
  combined,
}: {
  categories: EventCategoryStatistics[];
  combined: boolean;
}) {
  const { t } = useI18n();
  const rows: FinishPlotRow[] = combined
    ? [{
        slug: "all-races",
        name: t("event.detail.finishPlot.combined"),
        startAtIso: null,
        finishTimes: categories.flatMap((category) => category.finishTimes).sort((left, right) => left.finishTimeMs - right.finishTimeMs),
      }]
    : categories.map((category) => ({
        slug: category.slug,
        name: category.name,
        startAtIso: category.startAtIso,
        finishTimes: category.finishTimes,
      }));

  if (!categories.length) {
    return <p className="mt-6 text-sm text-muted-foreground">Finish-time rhythm appears when public race results are available.</p>;
  }

  return (
    <div className="mt-5 min-w-0">
      <div className="sm:hidden"><FinishRowsSvg rows={rows} compact /></div>
      <div className="hidden sm:block"><FinishRowsSvg rows={rows} compact={false} /></div>
    </div>
  );
}
