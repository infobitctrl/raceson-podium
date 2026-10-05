import { Link } from "react-router-dom";
import type { PublicResultsRow } from "@/lib/portal-read-models";
import {
  formatPublicResultWinnerGap,
  normalizePublicResultClubName,
} from "@/features/results/public/model/publicResultPresentation";
import { ResultPlaceBadge } from "./ResultPodiumVisual";
import { useI18n } from "@/shared/i18n/I18nContext";
import { CountryFlag } from "@/components/shared/CountryFlag";

function localizedResultStatus(status: PublicResultsRow["status"], t: ReturnType<typeof useI18n>["t"]) {
  if (status === "finished") return t("common.finished");
  if (status === "dnf") return t("results.status.dnf");
  if (status === "dns") return t("results.status.dns");
  if (status === "dsq") return t("results.status.dsq");
  return status;
}

export function MobileResultStandingRow({
  row,
  place,
  scopeLabel,
  winnerTimeMs,
}: {
  row: PublicResultsRow;
  place: number;
  scopeLabel: string;
  winnerTimeMs: number | null;
}) {
  const { t } = useI18n();
  const clubName = normalizePublicResultClubName(row.club);
  const winnerGapLabel = formatPublicResultWinnerGap(row, winnerTimeMs, t("common.winner"));
  return (
    <Link
      to={`/athletes/${row.athleteSlug}`}
      className="grid min-h-12 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border bg-card px-2 py-1.5 shadow-soft transition-colors [contain-intrinsic-size:0_3rem] [content-visibility:auto] active:bg-primary/[0.04]"
    >
      <div className="flex justify-center">
        {place > 0 ? (
          <ResultPlaceBadge place={place} compact scopeLabel={scopeLabel} />
        ) : (
          <span className="text-xs font-semibold text-muted-foreground">—</span>
        )}
      </div>

      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <CountryFlag countryCode={row.countryCode} className="text-sm" />
          <span className="truncate text-xs font-semibold leading-4 text-foreground">{row.name}</span>
        </span>
        <span className="block truncate text-[10px] leading-4 text-muted-foreground">
          {clubName || t("results.bib", { bib: row.bib })}
        </span>
      </span>

      <span className="min-w-0 text-right">
        <span className="block whitespace-nowrap font-mono text-[11px] font-bold text-foreground">{row.time}</span>
        {row.status === "finished" && winnerGapLabel !== "—" ? (
          <span
            aria-label={t("results.page.table.winnerGapAria", { gap: winnerGapLabel })}
            className="mt-0.5 block whitespace-nowrap font-mono text-[9px] font-semibold text-muted-foreground"
          >
            {winnerGapLabel}
          </span>
        ) : row.status !== "finished" ? (
          <span className="mt-0.5 block text-[8px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {localizedResultStatus(row.status, t)}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
