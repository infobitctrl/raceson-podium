import { MapPin, Users } from "lucide-react";
import { initialsForName } from "@/lib/account-presentation";
import type { AthletePublicRecord } from "@/features/athletes/components/AthleteIdentityBand";

export function AthletePublicProfileLivePreview({
  name,
  handle,
  avatarUrl,
  coverImageUrl,
  clubName,
  location,
  ageCategory,
  record,
}: {
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  coverImageUrl: string;
  clubName?: string | null;
  location?: string | null;
  ageCategory?: string | null;
  record: AthletePublicRecord;
}) {
  const profileName = name || "Athlete";

  return (
    <section
      aria-label="Live public profile preview"
      className="relative isolate min-h-[205px] overflow-hidden border-b border-border/70 bg-card sm:min-h-[230px]"
    >
      <img
        src={coverImageUrl}
        alt={`${profileName} public profile cover preview`}
        className="absolute inset-0 -z-20 h-full w-full object-cover object-center"
      />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,hsl(var(--card)/0.98)_0%,hsl(var(--card)/0.92)_38%,hsl(var(--card)/0.64)_68%,hsl(var(--card)/0.3)_100%)]" />
      <div className="absolute inset-0 -z-10 topo-pattern opacity-35" />

      <span className="absolute left-3 top-3 rounded-full border border-border/60 bg-card/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground shadow-2xs backdrop-blur-sm sm:left-4 sm:top-4">
        Live public preview
      </span>

      <div className="grid min-h-[205px] content-end gap-3 px-3 pb-3 pt-14 sm:min-h-[230px] sm:grid-cols-[minmax(0,1fr)_minmax(320px,0.82fr)] sm:items-end sm:gap-4 sm:px-5 sm:pb-5 sm:pt-16">
        <div className="flex min-w-0 items-end gap-2.5 sm:gap-3.5">
          <div className="flex h-16 w-16 shrink-0 overflow-hidden rounded-full border-[3px] border-card bg-primary/10 shadow-earth sm:h-24 sm:w-24 sm:border-4">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={`${profileName} public profile avatar preview`}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="m-auto font-display text-lg font-bold text-primary">
                {initialsForName(profileName)}
              </span>
            )}
          </div>

          <div className="min-w-0 pb-1">
            <h3 className="truncate font-display text-lg font-black tracking-tight text-foreground sm:text-2xl">{profileName}</h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground sm:mt-1 sm:gap-x-2.5 sm:gap-y-1 sm:text-[11px]">
              {handle ? <span className="font-semibold text-primary">@{handle}</span> : null}
              {clubName ? <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{clubName}</span> : null}
              {location ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{location}</span> : null}
              {ageCategory ? <span>{ageCategory}</span> : null}
            </div>
          </div>
        </div>

        <dl className="grid min-w-0 grid-cols-4 divide-x divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-card/90 shadow-soft backdrop-blur-sm">
          {[
            ["Races", record.races],
            ["Finishes", record.finishes],
            ["Distance", record.distance],
            ["Podiums", record.podiums],
          ].map(([label, value]) => (
            <div key={String(label)} className="min-w-0 px-1.5 py-2 text-center sm:py-3">
              <dt className="truncate text-[8px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 truncate font-display text-sm font-bold text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
