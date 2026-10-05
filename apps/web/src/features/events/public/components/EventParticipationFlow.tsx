import { useId } from "react";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { EventCategoryStatistics } from "../model/eventStatistics";

const COURSE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--trail-green))",
  "hsl(var(--trail-blue))",
  "#7f62b3",
];

function percentage(value: number, total: number) {
  return total ? Math.round(value / total * 100) : 0;
}

function flowPath(sourceX: number, sourceY: number, targetX: number, targetY: number, height: number) {
  if (height <= 0) return "";
  const middle = (sourceX + targetX) / 2;
  return [
    `M ${sourceX} ${sourceY}`,
    `C ${middle} ${sourceY} ${middle} ${targetY} ${targetX} ${targetY}`,
    `L ${targetX} ${targetY + height}`,
    `C ${middle} ${targetY + height} ${middle} ${sourceY + height} ${sourceX} ${sourceY + height}`,
    "Z",
  ].join(" ");
}

function nodeLabel({
  x,
  y,
  width,
  height,
  value,
  percent,
  textColor = "hsl(var(--foreground))",
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  percent?: number;
  textColor?: string;
}) {
  if (height < 20) return null;
  return (
    <text x={x + width / 2} y={y + height / 2 - (percent === undefined ? -4 : 2)} textAnchor="middle" dominantBaseline="middle" fill={textColor}>
      <tspan fontSize="13" fontWeight="900">{value}</tspan>
      {percent === undefined ? null : <tspan x={x + width / 2} dy="14" fontSize="9" fontWeight="800">{percent}%</tspan>}
    </text>
  );
}

export function EventParticipationFlow({
  categories,
}: {
  categories: EventCategoryStatistics[];
}) {
  const { t } = useI18n();
  const gradientPrefix = useId().replaceAll(":", "");
  const width = 780;
  const rowHeight = 144;
  const height = 48 + Math.max(1, categories.length) * rowHeight;
  const nodeWidth = 78;
  const xRegistered = 126;
  const xRaceDay = 384;
  const xOutcome = 642;
  const largestCategory = Math.max(1, ...categories.map((category) => category.entries));
  const ariaLabel = categories.map((category) => (
    t("event.detail.flow.categoryAria", { race: category.name, entries: category.entries, starters: category.starters, finishers: category.finishers, dnf: category.didNotFinish, dns: category.didNotStart })
  )).join(" ");

  if (!categories.length) {
    return <p className="mt-6 text-sm text-muted-foreground">{t("event.detail.flow.empty")}</p>;
  }

  return (
    <>
      <div className="mt-5 hidden min-w-0 sm:block">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={t("event.detail.flow.aria", { summary: ariaLabel })}>
          <defs>
            {categories.map((category, index) => {
              const color = COURSE_COLORS[index % COURSE_COLORS.length]!;
              return (
                <linearGradient key={category.slug} id={`${gradientPrefix}-${index}`} x1="0" x2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.78" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.28" />
                </linearGradient>
              );
            })}
          </defs>

          {[
            { x: xRegistered + nodeWidth / 2, label: t("event.detail.flow.registered"), detail: t("event.detail.flow.startList") },
            { x: xRaceDay + nodeWidth / 2, label: t("event.detail.flow.raceDay"), detail: t("event.detail.flow.startedDns") },
            { x: xOutcome + nodeWidth / 2, label: t("event.detail.flow.outcome"), detail: t("event.detail.flow.finishedDnf") },
          ].map((stage) => (
            <text key={stage.label} x={stage.x} y="14" textAnchor="middle" fill="hsl(var(--foreground))">
              <tspan fontSize="9" fontWeight="900">{stage.label}</tspan>
              <tspan x={stage.x} dy="13" fontSize="8" fontWeight="700" fill="hsl(var(--muted-foreground))">{stage.detail}</tspan>
            </text>
          ))}

          {categories.map((category, index) => {
            const color = COURSE_COLORS[index % COURSE_COLORS.length]!;
            const totalHeight = Math.max(46, category.entries / largestCategory * 72);
            const startedHeight = category.entries ? totalHeight * category.starters / category.entries : 0;
            const dnsHeight = Math.max(0, totalHeight - startedHeight);
            const finishedHeight = category.starters ? startedHeight * category.finishers / category.starters : 0;
            const dnfHeight = Math.max(0, startedHeight - finishedHeight);
            const splitGap = 7;
            const rowTop = 42 + index * rowHeight;
            const registeredY = rowTop + (rowHeight - totalHeight) / 2;
            const raceBlockHeight = startedHeight + (startedHeight > 0 && dnsHeight > 0 ? splitGap : 0) + dnsHeight;
            const raceTop = rowTop + (rowHeight - raceBlockHeight) / 2;
            const startedY = raceTop;
            const dnsY = raceTop + startedHeight + (startedHeight > 0 && dnsHeight > 0 ? splitGap : 0);
            const outcomeBlockHeight = finishedHeight + (finishedHeight > 0 && dnfHeight > 0 ? splitGap : 0) + dnfHeight;
            const outcomeTop = rowTop + (rowHeight - outcomeBlockHeight) / 2;
            const finishedY = outcomeTop;
            const dnfY = outcomeTop + finishedHeight + (finishedHeight > 0 && dnfHeight > 0 ? splitGap : 0);

            return (
              <g key={category.slug}>
                <text data-i18n-skip x="0" y={rowTop + rowHeight / 2 - 6} fill={color} fontSize="12" fontWeight="900">{category.name}</text>
                <text x="0" y={rowTop + rowHeight / 2 + 11} fill="hsl(var(--muted-foreground))" fontSize="9" fontWeight="700">{t("event.detail.flow.entries", { count: category.entries })}</text>

                <path d={flowPath(xRegistered + nodeWidth, registeredY, xRaceDay, startedY, startedHeight)} fill={`url(#${gradientPrefix}-${index})`} />
                <path d={flowPath(xRegistered + nodeWidth, registeredY + startedHeight, xRaceDay, dnsY, dnsHeight)} fill="hsl(var(--muted-foreground) / 0.18)" />
                <path d={flowPath(xRaceDay + nodeWidth, startedY, xOutcome, finishedY, finishedHeight)} fill="hsl(var(--trail-green) / 0.42)" />
                <path d={flowPath(xRaceDay + nodeWidth, startedY + finishedHeight, xOutcome, dnfY, dnfHeight)} fill="hsl(var(--trail-blue) / 0.34)" />

                <rect x={xRegistered} y={registeredY} width={nodeWidth} height={totalHeight} rx="8" fill={color} fillOpacity="0.88" />
                <rect x={xRaceDay} y={startedY} width={nodeWidth} height={startedHeight} rx="8" fill={color} fillOpacity="0.72" />
                {dnsHeight > 0 ? <rect x={xRaceDay} y={dnsY} width={nodeWidth} height={dnsHeight} rx="8" fill="hsl(var(--muted-foreground) / 0.24)" /> : null}
                <rect x={xOutcome} y={finishedY} width={nodeWidth} height={finishedHeight} rx="8" fill="hsl(var(--trail-green) / 0.82)" />
                {dnfHeight > 0 ? <rect x={xOutcome} y={dnfY} width={nodeWidth} height={dnfHeight} rx="8" fill="hsl(var(--trail-blue) / 0.78)" /> : null}

                {nodeLabel({ x: xRegistered, y: registeredY, width: nodeWidth, height: totalHeight, value: category.entries })}
                {nodeLabel({ x: xRaceDay, y: startedY, width: nodeWidth, height: startedHeight, value: category.starters, percent: percentage(category.starters, category.entries) })}
                {nodeLabel({ x: xRaceDay, y: dnsY, width: nodeWidth, height: dnsHeight, value: category.didNotStart, percent: percentage(category.didNotStart, category.entries) })}
                {nodeLabel({ x: xOutcome, y: finishedY, width: nodeWidth, height: finishedHeight, value: category.finishers, percent: percentage(category.finishers, category.starters) })}
                {nodeLabel({ x: xOutcome, y: dnfY, width: nodeWidth, height: dnfHeight, value: category.didNotFinish, percent: percentage(category.didNotFinish, category.starters), textColor: "white" })}

                {dnsHeight >= 20 ? <text data-i18n-skip x={xRaceDay + nodeWidth + 8} y={dnsY + dnsHeight / 2 + 3} fill="hsl(var(--muted-foreground))" fontSize="8" fontWeight="800">DNS</text> : null}
                {dnfHeight >= 20 ? <text data-i18n-skip x={xOutcome + nodeWidth + 8} y={dnfY + dnfHeight / 2 + 3} fill="hsl(var(--trail-blue))" fontSize="8" fontWeight="800">DNF</text> : null}
                {category.didNotFinish > 0 && dnfHeight < 20 ? <text data-i18n-skip x={xOutcome + nodeWidth + 8} y={dnfY + Math.max(4, dnfHeight / 2 + 3)} fill="hsl(var(--trail-blue))" fontSize="8" fontWeight="900">{category.didNotFinish} DNF</text> : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-5 space-y-4 sm:hidden" role="img" aria-label={t("event.detail.flow.aria", { summary: ariaLabel })}>
        {categories.map((category, index) => {
          const color = COURSE_COLORS[index % COURSE_COLORS.length]!;
          const startedShare = percentage(category.starters, category.entries);
          const finishShare = percentage(category.finishers, category.starters);
          return (
            <article key={category.slug} className="rounded-2xl border border-border/75 bg-background/55 p-4">
              <div className="flex items-end justify-between gap-3">
                <div><p className="font-black" style={{ color }} data-i18n-skip>{category.name}</p><p className="text-[0.65rem] text-muted-foreground">{t("event.detail.flow.entries", { count: category.entries })}</p></div>
                <p className="text-right font-display text-xl font-black">{category.finishers}<span className="ml-1 text-[0.6rem] font-bold text-muted-foreground">{t("event.detail.flow.finished")}</span></p>
              </div>
              <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[0.62rem] font-bold">
                <span>{t("event.detail.flow.raceDay")}</span>
                <div className="flex h-4 overflow-hidden rounded-full bg-muted">
                  <span style={{ width: `${startedShare}%`, backgroundColor: color }} aria-hidden="true" />
                  <span className="bg-muted-foreground/20" style={{ width: `${100 - startedShare}%` }} aria-hidden="true" />
                </div>
                <span>{t("event.detail.flow.outcome")}</span>
                <div className="flex h-4 overflow-hidden rounded-full bg-muted">
                  <span className="bg-[hsl(var(--trail-green))]" style={{ width: `${finishShare}%` }} aria-hidden="true" />
                  <span className="bg-[hsl(var(--trail-blue))]" style={{ width: `${100 - finishShare}%` }} aria-hidden="true" />
                </div>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[0.58rem] text-muted-foreground">
                <span><strong className="block text-xs text-foreground">{category.starters}</strong>{t("event.detail.flow.started")}</span>
                <span data-i18n-skip><strong className="block text-xs text-foreground">{category.didNotStart}</strong>DNS</span>
                <span><strong className="block text-xs text-foreground">{category.finishers}</strong>{t("event.detail.flow.finished")}</span>
                <span data-i18n-skip><strong className="block text-xs text-foreground">{category.didNotFinish}</strong>DNF</span>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
