export type LeagueChartMetric = "rank" | "points" | "best_time" | "participation";

export function buildLeagueChartAxis(values: number[], metric: LeagueChartMetric) {
  const finiteValues = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (metric === "rank") {
    const maximum = Math.max(1, ...finiteValues);
    return {
      ticks: Array.from({ length: maximum }, (_, index) => index + 1),
      position: (value: number) => (value - 1) / Math.max(1, maximum - 1),
    };
  }

  const minimum = metric === "best_time" ? Math.min(...finiteValues, Infinity) : 0;
  const maximum = Math.max(0, ...finiteValues);
  const lower = Number.isFinite(minimum) ? minimum : 0;
  const padding = metric === "best_time" ? Math.max(1, (maximum - lower || maximum) * 0.05) : 0;
  const start = Math.max(0, lower - padding);
  const end = Math.max(start + 1, maximum + padding);
  const roughStep = (end - start) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const numericStep = [1, 2, 2.5, 5, 10].find((step) => step * magnitude >= roughStep)! * magnitude;
  // Whole seconds/minutes make elapsed-time ticks readable without distorting spacing.
  const timeStep = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
    .map((seconds) => seconds * 1000)
    .find((step) => step >= roughStep);
  const step = metric === "best_time" && roughStep >= 1000
    ? timeStep ?? numericStep
    : metric === "participation" || metric === "best_time" ? Math.max(1, numericStep) : numericStep;
  const domainStart = Math.floor(start / step) * step;
  const domainEnd = Math.ceil(end / step) * step;
  const span = domainEnd - domainStart;

  return {
    ticks: Array.from({ length: Math.round(span / step) + 1 }, (_, index) => (
      Number((domainStart + index * step).toPrecision(12))
    )),
    position: (value: number) => metric === "best_time"
      ? (value - domainStart) / span
      : (domainEnd - value) / span,
  };
}

export function formatLeagueChartTime(milliseconds: number) {
  const elapsed = Math.max(0, Math.round(milliseconds));
  const totalSeconds = Math.floor(elapsed / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const fraction = elapsed % 1000;
  const clock = hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
  return fraction ? `${clock}.${String(fraction).padStart(3, "0")}` : clock;
}
