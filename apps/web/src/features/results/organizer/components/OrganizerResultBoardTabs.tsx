import { Trophy, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

export type OrganizerResultBoardView = "individual" | "clubs";

type ClubStanding = {
  clubId: string;
  clubName: string;
  rank: number;
  score: number;
  scorerNames: string[];
  scorerRanks: number[];
};

export function OrganizerResultBoardTabs({
  clubCount,
  onChange,
  value,
}: {
  clubCount: number;
  onChange: (value: OrganizerResultBoardView) => void;
  value: OrganizerResultBoardView;
}) {
  const options = [
    { id: "individual" as const, label: "Individual results", icon: Trophy },
    { id: "clubs" as const, label: "Club results", icon: UsersRound },
  ];

  return (
    <div
      role="tablist"
      aria-label="Results table view"
      className="inline-grid w-full grid-cols-2 rounded-xl border border-border bg-card p-1 shadow-soft sm:w-auto"
    >
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold transition-colors",
              selected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <option.icon className="h-3.5 w-3.5" aria-hidden="true" />
            {option.label}
            {option.id === "clubs" ? (
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[9px] tabular-nums",
                selected ? "bg-primary-foreground/15" : "bg-muted text-muted-foreground",
              )}>
                {clubCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function OrganizerClubResultsBoard({
  label,
  scoringCount,
  standings,
}: {
  label: string;
  scoringCount: number;
  standings: ClubStanding[];
}) {
  if (!standings.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center shadow-soft">
        <UsersRound className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
        <h3 className="mt-3 font-display text-base font-bold">No club results available</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          A club appears after at least one eligible finisher receives an official place.
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby={`${label.toLowerCase().replaceAll(" ", "-")}-club-results-title`} className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center gap-2 border-b border-border px-4 py-4 sm:px-5">
        <UsersRound className="h-4 w-4 text-primary" aria-hidden="true" />
        <div>
          <h3 id={`${label.toLowerCase().replaceAll(" ", "-")}-club-results-title`} className="font-display text-base font-bold">
            {label} club results
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Minimum 1 eligible finisher; up to the best {scoringCount} finishing {scoringCount === 1 ? "place" : "places"} count.
          </p>
        </div>
      </div>

      <div className="space-y-2 p-3 md:hidden" role="list" aria-label={`${label} club results compact view`}>
        {standings.map((standing) => (
          <article key={standing.clubId} role="listitem" className="rounded-xl border border-border bg-background px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-black text-primary">
                {standing.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="font-semibold text-foreground">{standing.clubName}</h4>
                  <span className="shrink-0 font-mono text-sm font-bold text-primary">{standing.score}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{standing.scorerNames.join(" · ")}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">Places {standing.scorerRanks.join(", ")}</p>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table aria-label={`${label} club results`} className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              <th className="w-20 px-4 py-3.5">Rank</th>
              <th className="px-4 py-3.5">Club</th>
              <th className="px-4 py-3.5">Scoring athletes</th>
              <th className="px-4 py-3.5">Counted places</th>
              <th className="w-24 px-4 py-3.5 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((standing) => (
              <tr key={standing.clubId} className="border-b border-border/30 transition-colors hover:bg-primary/[0.02]">
                <td className="px-4 py-3.5">
                  <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-black text-primary">
                    {standing.rank}
                  </span>
                </td>
                <td className="px-4 py-3.5 font-semibold">{standing.clubName}</td>
                <td className="px-4 py-3.5 text-muted-foreground">{standing.scorerNames.join(" · ")}</td>
                <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">{standing.scorerRanks.join(", ")}</td>
                <td className="px-4 py-3.5 text-right font-mono font-bold text-primary">{standing.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
