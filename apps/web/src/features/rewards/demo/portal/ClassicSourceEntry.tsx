import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useI18n } from "@/shared/i18n/I18nContext";
import { contextLink, portalCopy } from "./portalLinks";

/** Composition around existing event/league pages; no production nav edits. */
export default function ClassicSourceEntry({ children, league = false }: { children: ReactNode; league?: boolean }) {
  const { locale } = useI18n(), copy = portalCopy(locale), { eventId, seasonId, id } = useParams();
  const [search] = useSearchParams();
  return <><nav className="flex flex-wrap gap-4 border-b px-4 py-3 text-sm font-semibold" aria-label={copy.context}>
    <Link className="text-primary underline" to={contextLink({ event: eventId ?? (league ? undefined : id) ?? search.get("edition") ?? undefined, season: seasonId ?? (league ? id : undefined), draft: search.get("draft") ?? undefined })}>{copy.setup}</Link>
    <Link to="/athlete/rewards?experience=classic">{copy.athlete}</Link>
    <Link to="/club/rewards?experience=classic">{copy.club}</Link>
  </nav>{children}</>;
}
