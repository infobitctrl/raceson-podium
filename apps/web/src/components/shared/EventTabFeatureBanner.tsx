import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type EventTabFeatureStat = {
  label: string;
  value: string;
  icon: LucideIcon;
  helper?: string;
  tone?: "default" | "warm" | "cool" | "accent";
};

type EventTabFeatureBannerProps = {
  eyebrow: string;
  title: string;
  description: string;
  imageSrc: string;
  imageAlt: string;
  action?: {
    label: string;
    href: string;
    helper?: string;
  };
  badges?: string[];
  stats?: EventTabFeatureStat[];
  className?: string;
};

const statToneClasses: Record<NonNullable<EventTabFeatureStat["tone"]>, string> = {
  default: "text-primary",
  warm: "text-trail-amber",
  cool: "text-trail-blue",
  accent: "text-trail-green",
};

export default function EventTabFeatureBanner({
  eyebrow,
  title,
  description,
  imageSrc,
  imageAlt,
  action,
  badges = [],
  stats = [],
  className,
}: EventTabFeatureBannerProps) {
  return (
    <section
      className={cn(
        "rounded-[30px] border border-border/70 bg-card p-5 shadow-[0_22px_58px_-30px_rgba(15,23,42,0.18)] md:p-6",
        className,
      )}
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(280px,0.92fr)]">
        <div className="relative overflow-hidden rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,hsl(0_0%_100%_/_0.96),hsl(38_20%_98%_/_0.98))] p-6 shadow-soft dark:bg-[linear-gradient(180deg,hsl(var(--raised)),hsl(var(--card)))]">
          <div className="absolute inset-0 bg-gradient-to-br from-white/72 via-transparent to-primary/[0.04] dark:from-white/[0.025] dark:via-transparent dark:to-primary/[0.06]" />
          <div className="relative">
            <div className="inline-flex rounded-full border border-border/70 bg-background/88 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-muted-foreground shadow-soft">
              {eyebrow}
            </div>

            <h2 className="mt-4 max-w-[18ch] font-display text-[2rem] font-black leading-[0.98] tracking-[-0.04em] text-foreground md:text-[2.3rem]">
              {title}
            </h2>

            <p className="mt-4 max-w-[60ch] text-sm leading-7 text-muted-foreground">
              {description}
            </p>

            {badges.length ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {badges.map((badge) => (
                  <span
                    key={badge}
                    className="rounded-full border border-border/70 bg-background/92 px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-foreground shadow-soft"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            ) : null}

            {action ? (
              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
                <a
                  href={action.href}
                  className="group inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-warm transition-all hover:-translate-y-0.5 hover:shadow-glow"
                >
                  {action.label}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                {action.helper ? (
                  <span className="text-xs leading-5 text-muted-foreground">
                    {action.helper}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="group relative min-h-[220px] overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_18px_45px_-28px_hsl(25_30%_12%_/_0.35)]">
          <img
            src={imageSrc}
            alt={imageAlt}
            className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-700 will-change-transform group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(24_100%_48%_/_0.16)] via-[hsl(220_18%_10%_/_0.18)] to-[hsl(220_18%_9%_/_0.78)]" />
          <div className="absolute inset-0 bg-gradient-to-t from-[hsl(220_18%_8%_/_0.72)] via-[hsl(220_18%_10%_/_0.08)] to-[hsl(220_18%_10%_/_0.02)]" />
          <div className="absolute inset-0 grain-overlay opacity-25" />
          <div className="absolute inset-0 topo-pattern opacity-20" />

          <div className="absolute left-5 top-5 rounded-full border border-white/18 bg-black/24 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white backdrop-blur-md">
            {eyebrow}
          </div>

          <div className="absolute inset-x-5 bottom-5 rounded-[22px] border border-white/12 bg-black/24 p-4 text-white shadow-[0_18px_40px_-24px_rgba(0,0,0,0.72)] backdrop-blur-md">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/72">Graphic anchor</div>
            <div className="mt-2 text-base font-black leading-tight text-white">
              {title}
            </div>
            {badges.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {badges.slice(0, 2).map((badge) => (
                  <span
                    key={badge}
                    className="rounded-full border border-white/14 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/88"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {stats.length ? (
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-[24px] border border-border/70 bg-background/82 p-4 shadow-soft transition-all hover:border-primary/12"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-border/70 bg-background shadow-soft">
                  <stat.icon className={cn("h-5 w-5", statToneClasses[stat.tone ?? "default"])} />
                </div>
                <div className="min-w-0">
                  <div className="font-display text-2xl font-black leading-none tracking-[-0.03em] text-foreground">
                    {stat.value}
                  </div>
                  <div className="mt-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {stat.label}
                  </div>
                </div>
              </div>

              {stat.helper ? (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {stat.helper}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
