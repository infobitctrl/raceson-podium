import { ArrowRight, Camera, MapPin, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initialsForName } from "@/lib/account-presentation";
import { useI18n } from "@/shared/i18n/I18nContext";

export type AthletePublicRecord = {
  races: number;
  finishes: number;
  distance: string;
  podiums: number;
};

export function AthleteIdentityBand({
  name,
  handle,
  avatarUrl,
  coverImageUrl,
  clubName,
  location,
  completionPercent,
  record,
  ageCategory,
  recordLabel,
  completionTone = "primary",
  onAvatarClick,
  avatarActionDisabled = false,
}: {
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  coverImageUrl?: string | null;
  clubName?: string | null;
  location?: string | null;
  completionPercent: number;
  record: AthletePublicRecord;
  ageCategory?: string | null;
  recordLabel?: string;
  completionTone?: "primary" | "success";
  onAvatarClick?: () => void;
  avatarActionDisabled?: boolean;
}) {
  const { locale, t } = useI18n();
  const completionColor = completionTone === "success" ? "bg-emerald-600" : "bg-primary";
  const completionTextColor = completionTone === "success" ? "text-emerald-700 dark:text-emerald-400" : "text-primary";

  return (
    <section className="relative isolate mb-4 grid max-w-full grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-border bg-card shadow-soft lg:grid-cols-[minmax(300px,1fr)_minmax(220px,0.68fr)_minmax(420px,1.25fr)]">
      {coverImageUrl ? (
        <>
          <img src={coverImageUrl} alt="" className="absolute inset-y-0 right-0 -z-20 h-full w-[62%] object-cover opacity-[0.16] dark:opacity-10" />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,hsl(var(--card))_0%,hsl(var(--card)/0.98)_38%,hsl(var(--card)/0.82)_72%,hsl(var(--card)/0.62)_100%)]" />
          <div className="absolute inset-0 -z-10 topo-pattern opacity-60" />
        </>
      ) : null}
      <div className="flex min-w-0 items-center gap-4 p-5 sm:p-6">
        <div className="relative shrink-0">
          <Avatar className="h-20 w-20 border-[3px] border-card shadow-earth ring-1 ring-border sm:h-24 sm:w-24">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={locale === "hr" ? `Profilna slika korisnika ${name}` : `${name} profile picture`} className="object-cover" /> : null}
            <AvatarFallback className="bg-primary/10 font-display text-xl font-bold text-primary">
              {initialsForName(name)}
            </AvatarFallback>
          </Avatar>
          {onAvatarClick ? (
            <button
              type="button"
              aria-label="Change profile picture"
              disabled={avatarActionDisabled}
              onClick={onAvatarClick}
              className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-soft transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Camera className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-display text-2xl font-black tracking-tight text-foreground">{name}</h2>
          {handle ? <p className="mt-0.5 truncate text-xs font-medium text-primary">@{handle}</p> : null}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {clubName ? <div className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /><span className="truncate">{clubName}</span></div> : null}
            {location ? <div className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /><span className="truncate">{location}</span></div> : null}
            {ageCategory ? <span className="rounded-md border border-border bg-background px-1.5 py-0.5 font-semibold text-foreground">{ageCategory}</span> : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-center border-t border-border/70 bg-card/55 p-5 backdrop-blur-[2px] lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-semibold text-foreground">Profile completeness</span>
          <span className={`font-bold ${completionTextColor}`}>{completionPercent}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${completionColor}`} style={{ width: `${completionPercent}%` }} />
        </div>
        <Link to="/athlete/account" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          Complete profile
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="min-w-0 overflow-hidden border-t border-border/70 bg-card/55 backdrop-blur-[2px] lg:border-l lg:border-t-0">
        {recordLabel ? <p className="px-4 pt-3 text-xs font-medium text-foreground">{recordLabel}</p> : null}
        <dl className="grid h-full w-full min-w-0 grid-cols-4">
          {[
            [t("common.races"), record.races],
            [t("common.finishes"), record.finishes],
            [t("common.distance"), record.distance],
            [t("common.podiums"), record.podiums],
          ].map(([label, value], index) => (
            <div key={String(label)} className={`flex min-w-0 flex-col justify-center px-3 py-4 text-center ${index ? "border-l border-border/70" : ""}`}>
              <dt className="truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:text-[10px]">{label}</dt>
              <dd className="mt-1.5 truncate font-display text-lg font-black text-foreground sm:text-xl">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
