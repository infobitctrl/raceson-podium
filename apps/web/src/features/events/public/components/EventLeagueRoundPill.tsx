import { ArrowUpRight, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import {
  getSibenikTrailLeagueDisplayName,
  isSibenikTrailLeagueIdentity,
  SIBENIK_TRAIL_LEAGUE_SLUG,
} from "@/features/leagues/model/sibenikTrailLeagueIdentity";
import type { EventLeagueMembership } from "@/features/events/public/model/eventLeagueMembership";
import { useI18n } from "@/shared/i18n/I18nContext";

export function EventLeagueRoundPill({
  membership,
  compact = false,
  roundOnly = false,
  className = "",
}: {
  membership: EventLeagueMembership;
  compact?: boolean;
  roundOnly?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const leagueName = getSibenikTrailLeagueDisplayName(
    membership.leagueName,
    membership.leagueSlug,
  );
  const label = t("event.league.partOf", { league: leagueName, round: membership.roundNumber });
  const displayLabel = roundOnly
    ? t("league.calendar.round", { round: membership.roundNumber })
    : compact
      ? t("event.league.partOfCompact", { league: leagueName, round: membership.roundNumber })
      : label;
  const accessibleLabel = roundOnly ? label : displayLabel;
  const leagueSlug = isSibenikTrailLeagueIdentity(membership.leagueName)
    || isSibenikTrailLeagueIdentity(membership.leagueSlug)
    ? SIBENIK_TRAIL_LEAGUE_SLUG
    : membership.leagueSlug;

  return (
    <Link
      to={`/leagues/${leagueSlug}`}
      aria-label={t("event.league.viewAria", { label: accessibleLabel })}
      title={label}
      className={`portal-orange-pill relative z-20 inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold transition-[filter] hover:brightness-95 sm:text-[10px] ${className}`}
    >
      <Trophy className={roundOnly ? "h-2.5 w-2.5 shrink-0" : "h-3 w-3 shrink-0"} aria-hidden="true" />
      <span data-locale-fit="info-pill" className="truncate">{displayLabel}</span>
      <ArrowUpRight className={roundOnly ? "h-2.5 w-2.5 shrink-0" : "h-3 w-3 shrink-0"} aria-hidden="true" />
    </Link>
  );
}
