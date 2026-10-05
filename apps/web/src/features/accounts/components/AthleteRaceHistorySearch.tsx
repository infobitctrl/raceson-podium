import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { History, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/shared/i18n/I18nContext";
import {
  findAthleteProfileMatches,
  requestAthleteProfileClaim,
  type AthleteProfileMatch,
} from "@/features/accounts/data/identityGovernance";

type Identity = { firstName: string; lastName: string; dateOfBirth: string };

export function AthleteRaceHistorySearch({
  identity,
  ownProfileId,
}: {
  identity: Identity;
  ownProfileId: string;
}) {
  const { t, formatNumber } = useI18n();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState(identity);
  const [searchedIdentity, setSearchedIdentity] = useState<Identity | null>(null);
  const [matches, setMatches] = useState<AthleteProfileMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestedIds, setRequestedIds] = useState<string[]>([]);
  const directoryPath = `/athletes?search=${encodeURIComponent(`${form.firstName.trim()} ${form.lastName.trim()}`.trim())}`;
  const canRequest = searchedIdentity !== null
    && searchedIdentity.firstName === identity.firstName.trim()
    && searchedIdentity.lastName === identity.lastName.trim()
    && searchedIdentity.dateOfBirth === identity.dateOfBirth;

  function changeField(field: keyof Identity, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setMatches(null);
    setSearchedIdentity(null);
    setError(null);
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const input = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      dateOfBirth: form.dateOfBirth,
    };
    if (!input.firstName && !input.lastName) {
      setError(t("account.history.nameRequired"));
      return;
    }
    if (!input.dateOfBirth) {
      navigate(directoryPath);
      return;
    }
    if (!input.firstName || !input.lastName) {
      setError(t("account.history.identityRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setMatches(null);
    try {
      const result = await findAthleteProfileMatches(input);
      setMatches(result.filter((match) => match.athleteProfileId !== ownProfileId));
      setSearchedIdentity(input);
    } catch {
      setError(t("account.history.unavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function requestClaim(athleteProfileId: string) {
    if (busy || !canRequest || requestedIds.includes(athleteProfileId)) return;
    setBusy(true);
    setError(null);
    try {
      await requestAthleteProfileClaim(athleteProfileId);
      setRequestedIds((current) => [...current, athleteProfileId]);
    } catch {
      setError(t("account.history.claimError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="athlete-race-history" aria-labelledby="athlete-race-history-title" className="mb-4 scroll-mt-4 rounded-2xl border border-primary/20 bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <History className="mt-1 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-primary">{t("common.optional")}</p>
          <h2 id="athlete-race-history-title" className="font-display text-lg font-bold">{t("account.history.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("account.history.description")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy} aria-expanded={expanded} aria-controls="athlete-history-search" onClick={() => {
              if (!expanded) setForm(identity);
              setMatches(null);
              setError(null);
              setExpanded((current) => !current);
            }}>
              <Search className="h-4 w-4" />{t(expanded ? "account.history.close" : "account.history.open")}
            </Button>
            <Button asChild variant="ghost"><Link to="/athlete">{t("account.history.later")}</Link></Button>
          </div>
        </div>
      </div>
      {expanded ? (
        <div id="athlete-history-search" className="mt-4 space-y-4">
          <form onSubmit={search} className="space-y-3">
            <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-sm" htmlFor="history-first-name"><span>{t("common.firstName")}</span><Input id="history-first-name" autoComplete="given-name" value={form.firstName} onChange={(event) => changeField("firstName", event.target.value)} /></label>
              <label className="space-y-1 text-sm" htmlFor="history-last-name"><span>{t("account.history.lastName")}</span><Input id="history-last-name" autoComplete="family-name" value={form.lastName} onChange={(event) => changeField("lastName", event.target.value)} /></label>
              <label className="space-y-1 text-sm" htmlFor="history-date-of-birth"><span>{t("common.dateOfBirth")} · {t("common.optional")}</span><Input id="history-date-of-birth" type="date" autoComplete="bday" value={form.dateOfBirth} onChange={(event) => changeField("dateOfBirth", event.target.value)} /></label>
            </fieldset>
            <p className="text-xs text-muted-foreground">{t("account.history.searchHelp")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>{t(busy ? "auth.checkingHistory" : "account.history.search")}</Button>
              <Button asChild variant="ghost"><Link to={directoryPath}>{t("account.history.browse")}</Link></Button>
            </div>
          </form>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {matches?.length === 0 ? <p role="status" className="text-sm text-muted-foreground">{t("account.history.empty")}</p> : null}
          {matches && matches.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("account.history.reviewHelp")}</p>
              {!canRequest ? <p className="text-sm text-muted-foreground">{t("account.history.saveFirst")}</p> : null}
              <ul className="space-y-2">
                {matches.map((match) => (
                  <li key={match.athleteProfileId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                    <div>
                      <Link to={`/athletes/${encodeURIComponent(match.slug)}`} className="font-semibold text-primary hover:underline">{match.displayName}</Link>
                      <p className="text-xs text-muted-foreground">{match.location ?? t("auth.claim.locationHidden")} · {t("auth.claim.counts", { races: formatNumber(match.raceCount), results: formatNumber(match.resultCount) })}</p>
                    </div>
                    {requestedIds.includes(match.athleteProfileId) ? <p role="status" className="text-sm">{t("account.history.requested")}</p> : <Button type="button" variant="outline" disabled={busy || !canRequest} onClick={() => void requestClaim(match.athleteProfileId)}>{t("account.history.request")}</Button>}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
