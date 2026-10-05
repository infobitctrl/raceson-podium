import { Calendar, ChevronLeft, ChevronRight, Flag, MapPin, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import {
  buildLeagueEventHref,
  buildLeagueRoundNavigation,
} from "@/features/leagues/public/model/leagueRoundNavigation";
import type {
  PublicLeagueDetailReadModel,
  PublicLeagueRoundItem,
} from "@/lib/league-read-models";

function AdjacentRoundLink({
  direction,
  leagueSlug,
  round,
}: {
  direction: "previous" | "next";
  leagueSlug: string;
  round: PublicLeagueRoundItem | null;
}) {
  const isPrevious = direction === "previous";
  const label = isPrevious ? "Previous round" : "Next round";
  const Icon = isPrevious ? ChevronLeft : ChevronRight;

  if (!round) {
    return (
      <div
        aria-hidden="true"
        className="flex min-h-[72px] items-center rounded-2xl border border-dashed border-border/80 bg-card/45 px-3 text-muted-foreground"
      >
        <Icon className="h-4 w-4 shrink-0 text-primary/70" />
        <span className={`${isPrevious ? "ml-3" : "mr-3 text-right"} flex-1 text-[11px] font-bold uppercase tracking-[0.18em]`}>
          {isPrevious ? "Season start" : "Season finale"}
        </span>
      </div>
    );
  }

  return (
    <Link
      to={buildLeagueEventHref(leagueSlug, round.eventSlug)}
      aria-label={`${label}: Round ${round.roundNumber}, ${round.name}`}
      className="group flex min-h-[72px] items-center gap-2.5 overflow-hidden rounded-2xl border border-border/80 bg-card px-3 py-2.5 text-foreground shadow-soft transition-colors hover:border-primary/35 hover:bg-primary/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {isPrevious ? <Icon className="h-4 w-4 shrink-0 text-primary transition-transform group-hover:-translate-x-0.5" /> : null}
      {round.eventImageUrl ? (
        <img
          src={round.eventImageUrl}
          alt=""
          aria-hidden="true"
          className={`${isPrevious ? "order-none" : "order-2"} hidden h-12 w-12 rounded-xl border border-border/80 object-cover shadow-sm sm:block`}
        />
      ) : (
        <span className={`${isPrevious ? "order-none" : "order-2"} hidden h-12 w-12 items-center justify-center rounded-xl border border-border/80 bg-muted/60 sm:flex`}>
          <Flag className="h-4 w-4 text-primary" />
        </span>
      )}
      <span className={`${isPrevious ? "order-none" : "order-1 text-right"} min-w-0 flex-1`}>
        <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-primary">{label}</span>
        <span className="mt-1 block truncate font-display text-sm font-bold">Round {round.roundNumber} · {round.name}</span>
        <span className={`mt-1 items-center gap-1 text-[10px] text-muted-foreground ${isPrevious ? "flex" : "flex justify-end"}`}>
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{round.location}</span>
        </span>
      </span>
      {!isPrevious ? <Icon className="order-3 h-4 w-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" /> : null}
    </Link>
  );
}

export function LeagueRoundNavigation({
  eventSlug,
  league,
}: {
  eventSlug: string;
  league: PublicLeagueDetailReadModel;
}) {
  const navigation = buildLeagueRoundNavigation(league, eventSlug);
  if (!navigation) return null;

  return (
    <nav
      aria-label={`${league.name} round navigation`}
      className="relative overflow-hidden border-b border-border/70 bg-background text-foreground"
    >
      <div className="pointer-events-none absolute inset-0 route-pattern opacity-[0.04]" />
      <div className="container relative mx-auto grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.72fr)_minmax(0,1fr)] md:items-center md:gap-3">
        <AdjacentRoundLink
          direction="previous"
          leagueSlug={league.slug}
          round={navigation.previous}
        />

        <Link
          to={`/leagues/${encodeURIComponent(league.slug)}`}
          className="order-first col-span-2 flex min-w-0 flex-col items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.045] px-4 py-2.5 text-center transition-colors hover:border-primary/30 hover:bg-primary/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:order-none md:col-span-1"
        >
          <span className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.2em] text-primary">
            <Trophy className="h-3.5 w-3.5" />
            League circuit
          </span>
          <span className="mt-1 max-w-full truncate font-display text-base font-black">{league.name}</span>
          <span className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
            <Calendar className="h-3 w-3" />
            Round {navigation.current.roundNumber} of {navigation.roundCount}
          </span>
          <span className="mt-2 flex max-w-full items-center justify-center gap-1" aria-hidden="true">
            {Array.from({ length: navigation.roundCount }, (_, index) => (
              <span
                key={index}
                className={`h-1.5 rounded-full transition-all ${
                  index === navigation.position - 1
                    ? "w-6 bg-primary"
                    : index < navigation.position - 1
                      ? "w-2 bg-primary/35"
                      : "w-2 bg-border"
                }`}
              />
            ))}
          </span>
        </Link>

        <AdjacentRoundLink
          direction="next"
          leagueSlug={league.slug}
          round={navigation.next}
        />
      </div>
    </nav>
  );
}
