import { Fragment, useState, useCallback, useRef } from "react";
import { ComposedChart, Area, CartesianGrid, Line, ReferenceDot, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { TrendingUp, TrendingDown, Mountain, Zap } from "lucide-react";

export interface ElevPoint {
  distKm: number;
  elev: number;
  grade?: number;
  lat: number;
  lng: number;
}

interface InteractiveElevationProps {
  points: ElevPoint[];
  checkpoints?: { name: string; km: number; elev: number }[];
  onHover?: (point: ElevPoint | null) => void;
  onSelect?: (point: ElevPoint) => void;
  hoveredPoint?: ElevPoint | null;
  selectedKm?: number | null;
  highlightedRange?: { startKm: number; endKm: number } | null;
  highlightColor?: string;
  variant?: "default" | "immersive";
  showAnnotations?: boolean;
  showLegend?: boolean;
  showHeader?: boolean;
  className?: string;
  height?: number;
}

type ChartInteractionState = {
  activePayload?: Array<{ payload: ElevPoint }>;
};

const ROUTE_ORANGE = "hsl(24, 100%, 48%)";
const ELEVATION_STEP_FACTORS = [1, 2.5, 5, 10];
const DISTANCE_STEP_FACTORS = [1, 2, 5, 10];
const PROFILE_STACK_LINE_COUNT = 8;
const PROFILE_LAYER_FACTOR_STEP = 0.1;
const PROFILE_LAYER_FACTOR_OFFSET = 2;
const PROFILE_TOP_BAND_INTENSITY_MULTIPLIER = 2;
const PROFILE_SHADOW_INTENSITY_BOOST = 1.5;

function computePointGrade(points: ElevPoint[], index: number) {
  if (points.length <= 1) return 0;
  if (index === 0) {
    const next = points[1];
    const horizontalDistanceM = Math.max(0, (next.distKm - points[0].distKm) * 1000);
    if (horizontalDistanceM <= 0) return 0;
    return Number((((next.elev - points[0].elev) / horizontalDistanceM) * 100).toFixed(1));
  }
  if (index === points.length - 1) {
    const previous = points[index - 1];
    const horizontalDistanceM = Math.max(0, (points[index].distKm - previous.distKm) * 1000);
    if (horizontalDistanceM <= 0) return 0;
    return Number((((points[index].elev - previous.elev) / horizontalDistanceM) * 100).toFixed(1));
  }

  const previous = points[index - 1];
  const next = points[index + 1];
  const horizontalDistanceM = Math.max(0, (next.distKm - previous.distKm) * 1000);
  if (horizontalDistanceM <= 0) return 0;
  return Number((((next.elev - previous.elev) / horizontalDistanceM) * 100).toFixed(1));
}

function withResolvedGrades(points: ElevPoint[]) {
  const hasMeaningfulStoredGrades = points.some((point) => point.grade != null && Math.abs(point.grade) > 0.05);
  if (hasMeaningfulStoredGrades) {
    return points.map((point) => ({ ...point, grade: point.grade ?? 0 }));
  }

  return points.map((point, index) => ({
    ...point,
    grade: computePointGrade(points, index),
  }));
}

function getGradeColor(grade: number): string {
  if (grade > 20) return "hsl(var(--destructive))";
  if (grade > 12) return "hsl(var(--trail-red))";
  if (grade > 6) return "hsl(var(--trail-amber))";
  if (grade > 0) return "hsl(var(--trail-green))";
  return "hsl(var(--trail-blue))";
}

function getGradeLabel(grade: number): string {
  if (grade > 20) return "Extreme";
  if (grade > 12) return "Steep";
  if (grade > 6) return "Moderate";
  if (grade > 0) return "Gentle";
  if (grade > -6) return "Easy descent";
  return "Steep descent";
}

function formatDistanceTick(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.5 ? 1 : 2;
  const rounded = value.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  return `${rounded} km`;
}

function getRoundedElevationStep(rawStep: number) {
  const normalized = Math.max(10, rawStep);
  const magnitude = 10 ** Math.floor(Math.log10(normalized));
  const scaled = normalized / magnitude;
  const factor = ELEVATION_STEP_FACTORS.find((candidate) => scaled <= candidate) ?? 10;
  return factor * magnitude;
}

function getRoundedDistanceStep(rawStep: number) {
  const normalized = Math.max(0.1, rawStep);
  const magnitude = 10 ** Math.floor(Math.log10(normalized));
  const scaled = normalized / magnitude;
  const factor = DISTANCE_STEP_FACTORS.find((candidate) => scaled <= candidate) ?? 10;
  return factor * magnitude;
}

function buildDistanceTicks(totalDist: number) {
  const step = getRoundedDistanceStep(totalDist / 6);
  const ticks: number[] = [];

  for (let value = 0; value <= totalDist + step * 0.25; value += step) {
    ticks.push(Number(value.toFixed(4)));
  }

  return { step, ticks };
}

function buildElevationScale(minElev: number, maxElev: number) {
  const range = Math.max(10, maxElev - minElev);
  const step = getRoundedElevationStep(range / 6);
  const paddedMin = Math.max(0, minElev - step * 0.2);
  const paddedMax = maxElev + step * 0.4;
  const domainMin = Math.max(0, Math.floor(paddedMin / step) * step);
  const domainMax = Math.max(domainMin + step, Math.ceil(paddedMax / step) * step);
  const ticks: number[] = [];

  for (let value = domainMin; value <= domainMax + step * 0.5; value += step) {
    ticks.push(Number(value.toFixed(4)));
  }

  return { domainMin, domainMax, ticks };
}

function getProfileLayerFactor(index: number, maxFactor = 1) {
  return Math.min((index + PROFILE_LAYER_FACTOR_OFFSET) * PROFILE_LAYER_FACTOR_STEP, maxFactor);
}

function buildAnnotationLabel(
  symbol: string,
  text: string,
  symbolColor: string,
  textColor: string,
  side: "left" | "right" = "right",
) {
  return (props: { x?: number; y?: number; viewBox?: { x?: number; y?: number } }) => {
    const x = props.x ?? props.viewBox?.x;
    const y = props.y ?? props.viewBox?.y;

    if (typeof x !== "number" || typeof y !== "number") return null;
    const baselineY = Math.max(y - 12, 22);
    const textOffset = 9;
    const textX = side === "right" ? x + textOffset : x - textOffset;
    const textAnchor = side === "right" ? "start" : "end";

    return (
      <g>
        <text x={x} y={baselineY} textAnchor="middle" fontSize={9} fontWeight={700} fill={symbolColor}>
          {symbol}
        </text>
        <text
          x={textX}
          y={baselineY}
          textAnchor={textAnchor}
          fontSize={9}
          fontWeight={700}
          fill={textColor}
        >
          {text}
        </text>
      </g>
    );
  };
}

function findExtremePoint(points: ElevPoint[], mode: "min" | "max") {
  return points.reduce((current, point) => {
    if (!current) return point;
    if (mode === "max") {
      return point.elev > current.elev ? point : current;
    }
    return point.elev < current.elev ? point : current;
  }, points[0] ?? null);
}

function pointsShareAnnotationPosition(
  left: { distKm: number; elev: number } | null | undefined,
  right: { distKm: number; elev: number } | null | undefined,
  distanceToleranceKm: number,
  elevationToleranceM = 8,
) {
  if (!left || !right) return false;

  return (
    Math.abs(left.distKm - right.distKm) <= distanceToleranceKm &&
    Math.abs(left.elev - right.elev) <= elevationToleranceM
  );
}

function CustomTooltip({
  active,
  payload,
  variant = "default",
}: {
  active?: boolean;
  payload?: Array<{ payload: ElevPoint }>;
  variant?: "default" | "immersive";
}) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload as ElevPoint;
  const grade = point.grade ?? 0;
  const immersive = variant === "immersive";

  return (
    <div
      className={`space-y-1.5 rounded-xl border px-3.5 py-2.5 text-xs shadow-lg backdrop-blur-md ${
        immersive
          ? "border-white/10 bg-[rgba(10,12,14,0.94)] text-white shadow-black/40"
          : "border-border bg-card/95 text-foreground"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="font-display text-sm font-bold">{Math.round(point.elev)}m</span>
        <span className={immersive ? "text-white/60" : "text-muted-foreground"}>km {point.distKm.toFixed(1)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
          style={{ background: `${getGradeColor(grade)}20`, color: getGradeColor(grade) }}
        >
          {grade > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
          {grade > 0 ? "+" : ""}{grade.toFixed(1)}%
        </span>
        <span className={immersive ? "text-white/50" : "text-muted-foreground/70"}>{getGradeLabel(grade)}</span>
      </div>
    </div>
  );
}

export default function InteractiveElevation({
  points,
  checkpoints = [],
  onHover,
  onSelect,
  hoveredPoint = null,
  selectedKm = null,
  highlightedRange = null,
  highlightColor = "hsl(var(--trail-blue))",
  variant = "default",
  showAnnotations = true,
  showLegend = true,
  showHeader = true,
  className = "",
  height = 294,
}: InteractiveElevationProps) {
  const immersive = variant === "immersive";
  const mutedTextColor = immersive ? "rgba(255,255,255,0.62)" : "hsl(var(--muted-foreground))";
  const axisColor = immersive ? "rgba(255,255,255,0.18)" : "hsl(var(--border))";
  const xGridColor = immersive ? "rgba(255,255,255,0.1)" : "hsl(var(--muted-foreground))";
  const activeLineColor = immersive ? "rgba(255,255,255,0.4)" : "hsl(var(--primary))";
  const containerClasses = immersive
    ? "border-primary/20 bg-[radial-gradient(circle_at_top_left,rgba(255,128,18,0.18),transparent_34%),linear-gradient(180deg,rgba(8,10,12,0.96),rgba(12,14,16,0.94))] text-white shadow-[0_20px_60px_-32px_rgba(0,0,0,0.75)]"
    : "border-border bg-card";
  const [activePoint, setActivePoint] = useState<ElevPoint | null>(null);
  const lastHoverDistanceKmRef = useRef<number | null>(null);

  const handleMouseMove = useCallback(
    (state: ChartInteractionState) => {
      const point = state?.activePayload?.[0]?.payload as ElevPoint | undefined;
      if (!point) return;
      if (lastHoverDistanceKmRef.current != null && Math.abs(lastHoverDistanceKmRef.current - point.distKm) < 0.0001) {
        return;
      }

      lastHoverDistanceKmRef.current = point.distKm;
      setActivePoint(point);
      onHover?.(point);
    },
    [onHover],
  );

  const handleMouseLeave = useCallback(() => {
    if (lastHoverDistanceKmRef.current == null) return;

    lastHoverDistanceKmRef.current = null;
    setActivePoint(null);
    onHover?.(null);
  }, [onHover]);

  const handleClick = useCallback(
    (state: ChartInteractionState) => {
      const point = state?.activePayload?.[0]?.payload as ElevPoint | undefined;
      if (point) {
        onSelect?.(point);
      }
    },
    [onSelect],
  );

  if (points.length < 2) {
    return (
      <div className={`min-w-0 w-full max-w-full overflow-hidden rounded-2xl border p-4 shadow-soft ${containerClasses} ${className}`}>
        <div className="flex min-h-[180px] items-center justify-center text-center">
          <div className="max-w-sm space-y-2">
            <div className={`text-sm font-semibold ${immersive ? "text-white" : "text-foreground"}`}>
              Elevation unavailable
            </div>
            <p className={`text-sm ${immersive ? "text-white/60" : "text-muted-foreground"}`}>
              GPX elevation points required.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const pointsWithGrades = withResolvedGrades(points);
  const minElev = Math.min(...pointsWithGrades.map((point) => point.elev));
  const maxElev = Math.max(...pointsWithGrades.map((point) => point.elev));
  const totalDist = pointsWithGrades[pointsWithGrades.length - 1]?.distKm ?? 0;
  const { domainMin, domainMax, ticks: yTicks } = buildElevationScale(minElev, maxElev);
  const { step: distanceStep, ticks: distanceTicks } = buildDistanceTicks(totalDist);
  const peakPoint = findExtremePoint(pointsWithGrades, "max");
  const lowPoint = findExtremePoint(pointsWithGrades, "min");
  const markerDistanceToleranceKm = Math.max(totalDist * 0.003, 0.015);
  const peakOverlapsCheckpoint = checkpoints.some((checkpoint) => (
    pointsShareAnnotationPosition(
      peakPoint,
      { distKm: checkpoint.km, elev: checkpoint.elev },
      markerDistanceToleranceKm,
    )
  ));
  const lowOverlapsCheckpoint = checkpoints.some((checkpoint) => (
    pointsShareAnnotationPosition(
      lowPoint,
      { distKm: checkpoint.km, elev: checkpoint.elev },
      markerDistanceToleranceKm,
    )
  ));
  const lowMatchesPeak = pointsShareAnnotationPosition(
    peakPoint,
    lowPoint,
    markerDistanceToleranceKm,
    4,
  );
  const yStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : getRoundedElevationStep((domainMax - domainMin) / 4);
  const markerGuideTopY = domainMax - yStep * 0.12;
  const annotationColor = "hsl(var(--primary))";
  const waypointAnnotationColor = immersive ? "rgba(255,255,255,0.42)" : "hsl(var(--muted-foreground))";
  const profileStripeKeys = Array.from({ length: PROFILE_STACK_LINE_COUNT }, (_, index) => `elevStripe${index + 1}`);
  const profileFillKeys = Array.from({ length: PROFILE_STACK_LINE_COUNT }, (_, index) => `elevFill${index + 1}`);
  const mainProfileStrokeWidth = immersive ? 2.25 : 2;
  const hoverIndicatorPoint = activePoint ?? hoveredPoint;
  const hoverIndicatorColor = activePoint ? ROUTE_ORANGE : activeLineColor;
  const shadowBaseOpacity = (immersive ? 0.09 : 0.05) * PROFILE_SHADOW_INTENSITY_BOOST;
  const chartPoints = pointsWithGrades.map((point) => ({
    ...point,
    ...Object.fromEntries(
      (() => {
        const bandStep = (point.elev - domainMin) / PROFILE_STACK_LINE_COUNT;
        const stripeEntries = profileStripeKeys.map((key, index) => [
          key,
          domainMin + bandStep * (index + 1),
        ]);
        const fillEntries = profileFillKeys.map((key, index) => [
          key,
          [domainMin + bandStep * index, domainMin + bandStep * (index + 1)],
        ]);

        return [...stripeEntries, ...fillEntries];
      })(),
    ),
    segmentElev:
      highlightedRange && point.distKm >= highlightedRange.startKm && point.distKm <= highlightedRange.endKm
        ? point.elev
        : null,
  }));

  return (
    <div className={`min-w-0 w-full max-w-full overflow-hidden rounded-2xl border p-4 shadow-soft ${containerClasses} ${className}`}>
      {showHeader ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Mountain className="h-4 w-4 text-primary" />
            <span className={`font-display text-xs font-bold uppercase tracking-wider ${immersive ? "text-white/60" : "text-muted-foreground"}`}>
              Interactive Elevation Profile
            </span>
          </div>
        </div>
      ) : null}

      <ResponsiveContainer width="100%" height={height} minWidth={0}>
        <ComposedChart
          data={chartPoints}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          margin={{ top: 18, right: 8, bottom: 18, left: -20 }}
        >
          <CartesianGrid
            horizontal={false}
            vertical
            stroke={xGridColor}
            strokeOpacity={immersive ? 0.28 : 0.32}
            strokeDasharray="1 6"
          />
          <XAxis
            type="number"
            dataKey="distKm"
            domain={[0, totalDist]}
            ticks={distanceTicks}
            allowDuplicatedCategory={false}
            tick={{ fontSize: 10, fill: mutedTextColor }}
            tickFormatter={(value: number) => formatDistanceTick(value, distanceStep)}
            axisLine={{ stroke: axisColor, strokeOpacity: immersive ? 1 : 0.7 }}
            tickLine={{ stroke: axisColor, strokeOpacity: immersive ? 0.75 : 0.45 }}
            label={{
              value: "Distance (km)",
              position: "insideBottom",
              offset: -10,
              fill: mutedTextColor,
              fontSize: 10,
            }}
          />
          <YAxis
            domain={[domainMin, domainMax]}
            ticks={yTicks}
            tick={{ fontSize: 10, fill: mutedTextColor }}
            tickFormatter={(value: number) => `${value}m`}
            axisLine={false}
            tickLine={false}
          />
          {yTicks.slice(1, -1).map((tick) => (
            <ReferenceLine
              key={`y-grid-${tick}`}
              y={tick}
              stroke={xGridColor}
              strokeOpacity={immersive ? 0.28 : 0.32}
              strokeDasharray="1 6"
              ifOverflow="extendDomain"
            />
          ))}
          <Tooltip
            content={<CustomTooltip variant={variant} />}
            cursor={{ stroke: activeLineColor, strokeWidth: 1, strokeDasharray: "4 4" }}
          />
          {hoverIndicatorPoint ? (
            <Fragment>
              <ReferenceLine
                x={hoverIndicatorPoint.distKm}
                stroke={activeLineColor}
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
              <ReferenceDot
                x={hoverIndicatorPoint.distKm}
                y={hoverIndicatorPoint.elev}
                r={4.5}
                fill={hoverIndicatorColor}
                stroke={immersive ? "rgba(8,10,12,0.96)" : "hsl(var(--background))"}
                strokeWidth={2}
                ifOverflow="extendDomain"
              />
            </Fragment>
          ) : null}
          {showAnnotations && peakPoint && !peakOverlapsCheckpoint ? (
            <Fragment>
              <ReferenceLine
                segment={[
                  { x: peakPoint.distKm, y: domainMin },
                  { x: peakPoint.distKm, y: markerGuideTopY },
                ]}
                stroke={annotationColor}
                strokeOpacity={immersive ? 0.9 : 0.45}
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
              />
              <ReferenceDot
                x={peakPoint.distKm}
                y={peakPoint.elev}
                r={5}
                fill={annotationColor}
                stroke={immersive ? "rgba(8,10,12,0.96)" : "hsl(var(--background))"}
                strokeWidth={2}
                ifOverflow="extendDomain"
              />
              <ReferenceDot
                x={peakPoint.distKm}
                y={markerGuideTopY}
                r={0}
                fill="transparent"
                stroke="transparent"
                ifOverflow="extendDomain"
                label={buildAnnotationLabel(
                  "▲",
                  `Peak · ${Math.round(peakPoint.elev)}m`,
                  annotationColor,
                  mutedTextColor,
                  "right",
                )}
              />
            </Fragment>
          ) : null}
          {showAnnotations && lowPoint && !lowOverlapsCheckpoint && !lowMatchesPeak ? (
            <Fragment>
              <ReferenceLine
                segment={[
                  { x: lowPoint.distKm, y: domainMin },
                  { x: lowPoint.distKm, y: markerGuideTopY },
                ]}
                stroke={annotationColor}
                strokeOpacity={immersive ? 0.9 : 0.45}
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
              />
              <ReferenceDot
                x={lowPoint.distKm}
                y={lowPoint.elev}
                r={5}
                fill={annotationColor}
                stroke={immersive ? "rgba(8,10,12,0.96)" : "hsl(var(--background))"}
                strokeWidth={2}
                ifOverflow="extendDomain"
              />
              <ReferenceDot
                x={lowPoint.distKm}
                y={markerGuideTopY}
                r={0}
                fill="transparent"
                stroke="transparent"
                ifOverflow="extendDomain"
                label={buildAnnotationLabel(
                  "▼",
                  `Low · ${Math.round(lowPoint.elev)}m`,
                  annotationColor,
                  mutedTextColor,
                  "right",
                )}
              />
            </Fragment>
          ) : null}
          {selectedKm != null ? (
            <ReferenceLine
              x={selectedKm}
              stroke={activeLineColor}
              strokeWidth={2}
              strokeDasharray="5 5"
            />
          ) : null}
          {profileFillKeys.map((key, index) => {
            const fillFactor = getProfileLayerFactor(index);
            const fillOpacity = index === profileFillKeys.length - 1
              ? Math.min(
                  shadowBaseOpacity * fillFactor * PROFILE_TOP_BAND_INTENSITY_MULTIPLIER,
                  (immersive ? 0.18 : 0.1) * PROFILE_SHADOW_INTENSITY_BOOST,
                )
              : shadowBaseOpacity * fillFactor;

            return (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke="none"
                fill={ROUTE_ORANGE}
                fillOpacity={fillOpacity}
                activeDot={false}
                isAnimationActive={false}
              />
            );
          })}
          {profileStripeKeys.map((key, index) => {
            const stripeFactor = getProfileLayerFactor(index, 0.9);

            return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={ROUTE_ORANGE}
                strokeWidth={Math.max(mainProfileStrokeWidth * stripeFactor, 0.35)}
                strokeOpacity={stripeFactor}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            );
          })}
          <Line
            type="monotone"
            dataKey="elev"
            stroke={ROUTE_ORANGE}
            strokeWidth={mainProfileStrokeWidth}
            strokeOpacity={1}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          {highlightedRange && highlightedRange.endKm > highlightedRange.startKm ? (
            <Line
              type="monotone"
              dataKey="segmentElev"
              stroke={highlightColor}
              strokeWidth={3}
              connectNulls={false}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          ) : null}
          {showAnnotations ? checkpoints.flatMap((checkpoint, index) => {
            const isStartOrFinish = index === 0 || index === checkpoints.length - 1;
            const checkpointColor = isStartOrFinish ? annotationColor : waypointAnnotationColor;
            const checkpointLabel = checkpoint.name
              .split(" — ")[0]
              .replace("CP", "")
              .replace("Start", "S")
              .replace("Finish", "F");

            return [
              <ReferenceLine
                key={`${checkpoint.name}-guide`}
                segment={[
                  { x: checkpoint.km, y: domainMin },
                  { x: checkpoint.km, y: markerGuideTopY },
                ]}
                stroke={checkpointColor}
                strokeOpacity={immersive ? 0.9 : 0.55}
                strokeDasharray={isStartOrFinish ? "5 4" : "1 6"}
                ifOverflow="extendDomain"
              />,
              <ReferenceDot
                key={`${checkpoint.name}-point`}
                x={checkpoint.km}
                y={checkpoint.elev}
                r={4.5}
                fill={checkpointColor}
                stroke={immersive ? "rgba(8,10,12,0.96)" : "hsl(var(--background))"}
                strokeWidth={2}
                ifOverflow="extendDomain"
              />,
              <ReferenceDot
                key={`${checkpoint.name}-label`}
                x={checkpoint.km}
                y={markerGuideTopY}
                r={0}
                fill="transparent"
                stroke="transparent"
                ifOverflow="extendDomain"
                label={buildAnnotationLabel(
                  "●",
                  checkpointLabel,
                  checkpointColor,
                  mutedTextColor,
                  index === checkpoints.length - 1 ? "left" : "right",
                )}
              />,
            ];
          }) : null}
        </ComposedChart>
      </ResponsiveContainer>

      {showLegend ? (
        <div className={`mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10px] ${immersive ? "text-white/60" : "text-muted-foreground"}`}>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: "hsl(var(--trail-green))" }} />
            Gentle
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: "hsl(var(--trail-amber))" }} />
            Moderate
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: "hsl(var(--trail-red))" }} />
            Steep
          </span>
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3 text-primary" />
            Hover the map or chart to sync both
          </span>
        </div>
      ) : null}

    </div>
  );
}
