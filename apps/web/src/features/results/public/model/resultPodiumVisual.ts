export type ResultPodiumVisual = {
  label: string;
  shortLabel: "Gold" | "Silver" | "Bronze";
  rowClassName: string;
  badgeClassName: string;
  cardClassName: string;
  labelClassName: string;
};

const resultPodiumVisuals: Record<1 | 2 | 3, ResultPodiumVisual> = {
  1: {
    label: "Winner",
    shortLabel: "Gold",
    rowClassName:
      "bg-gradient-to-r from-amber-100/90 via-yellow-50/80 to-card shadow-[inset_4px_0_0_#f59e0b] hover:from-amber-100 dark:from-amber-950/55 dark:via-amber-950/20 dark:to-card dark:hover:from-amber-950/70",
    badgeClassName:
      "border-amber-300 bg-gradient-to-br from-amber-100 to-yellow-300 text-amber-950 shadow-[0_8px_20px_-12px_rgba(217,119,6,0.9)]",
    cardClassName:
      "border-amber-300/90 bg-gradient-to-br from-amber-100/90 via-yellow-50/80 to-card shadow-[0_18px_45px_-28px_rgba(217,119,6,0.75)] dark:border-amber-600/60 dark:from-amber-950/60 dark:via-amber-950/20 dark:to-card",
    labelClassName: "text-amber-800 dark:text-amber-300",
  },
  2: {
    label: "Second place",
    shortLabel: "Silver",
    rowClassName:
      "bg-gradient-to-r from-slate-100/95 via-slate-50/80 to-card shadow-[inset_4px_0_0_#94a3b8] hover:from-slate-200/80 dark:from-slate-800/65 dark:via-slate-900/25 dark:to-card dark:hover:from-slate-800/80",
    badgeClassName:
      "border-slate-300 bg-gradient-to-br from-white to-slate-300 text-slate-800 shadow-[0_8px_20px_-12px_rgba(71,85,105,0.72)]",
    cardClassName:
      "border-slate-300/90 bg-gradient-to-br from-slate-100/95 via-white/80 to-card shadow-[0_18px_45px_-28px_rgba(71,85,105,0.6)] dark:border-slate-600/60 dark:from-slate-800/70 dark:via-slate-900/25 dark:to-card",
    labelClassName: "text-slate-700 dark:text-slate-300",
  },
  3: {
    label: "Third place",
    shortLabel: "Bronze",
    rowClassName:
      "bg-gradient-to-r from-orange-100/85 via-orange-50/70 to-card shadow-[inset_4px_0_0_#c2410c] hover:from-orange-100 dark:from-orange-950/55 dark:via-orange-950/20 dark:to-card dark:hover:from-orange-950/70",
    badgeClassName:
      "border-orange-400 bg-gradient-to-br from-orange-100 to-orange-400 text-orange-950 shadow-[0_8px_20px_-12px_rgba(194,65,12,0.82)]",
    cardClassName:
      "border-orange-300/90 bg-gradient-to-br from-orange-100/90 via-orange-50/75 to-card shadow-[0_18px_45px_-28px_rgba(194,65,12,0.68)] dark:border-orange-700/60 dark:from-orange-950/60 dark:via-orange-950/20 dark:to-card",
    labelClassName: "text-orange-800 dark:text-orange-300",
  },
};

export function getResultPodiumVisual(place: number) {
  return place === 1 || place === 2 || place === 3
    ? resultPodiumVisuals[place]
    : null;
}
