import { Link } from "react-router-dom";
import { Plus, type LucideIcon } from "lucide-react";
import Image from "next/image";
import HeroMountainDivider from "@/components/shared/HeroMountainDivider";
import { cn } from "@/lib/utils";

type SubpageHeroStat = {
  label: string;
  value: string;
  icon: LucideIcon;
  toneClassName?: string;
};

type SubpageHeroProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  imageSrc: string;
  imageAlt: string;
  badges?: string[];
  stats?: SubpageHeroStat[];
  action?: {
    label: string;
    to: string;
  };
  actionLinkMode?: "spa" | "document";
  imagePositionClassName?: string;
  titleClassName?: string;
  className?: string;
  statsDensity?: "default" | "compact";
};

export default function SubpageHero({
  eyebrow = "Explore",
  title,
  description,
  imageSrc,
  imageAlt,
  badges = [],
  stats = [],
  action,
  actionLinkMode = "spa",
  imagePositionClassName = "object-center",
  titleClassName,
  className,
  statsDensity = "default",
}: SubpageHeroProps) {
  return (
    <section
      className={cn(
        "relative min-h-[10rem] overflow-hidden sm:min-h-[24rem] md:min-h-[28rem] lg:min-h-[30rem]",
        className,
      )}
    >
      <Image
        src={imageSrc}
        alt={imageAlt}
        fill
        sizes="100vw"
        quality={75}
        preload
        className={cn("absolute inset-0 h-full w-full object-cover brightness-[1.08] saturate-[1.06]", imagePositionClassName)}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[hsl(220,18%,10%,0.62)] via-[hsl(220,18%,10%,0.3)] to-[hsl(220,18%,10%,0.08)]" />
      <div className="absolute inset-0 bg-gradient-to-t from-[hsl(220,18%,9%,0.56)] via-[hsl(220,18%,10%,0.12)] to-[hsl(220,18%,9%,0.02)]" />
      <div className="absolute inset-0 ridge-pattern opacity-18" />
      <div className="absolute inset-0 route-pattern opacity-24 mix-blend-soft-light" />
      <div className="absolute inset-0 grain-overlay opacity-20" />

      <div className="pointer-events-none absolute left-[-5%] top-[16%] h-40 w-40 rounded-full bg-primary/18 blur-[90px]" />
      <div className="pointer-events-none absolute right-[8%] top-[8%] h-44 w-44 rounded-full bg-trail-amber/10 blur-[96px]" />
      <div className="pointer-events-none absolute bottom-[18%] right-[18%] h-28 w-28 rounded-full bg-trail-blue/10 blur-[80px]" />

      <div className="container relative z-10 mx-auto flex min-h-[10rem] px-4 pb-7 pt-8 sm:min-h-[24rem] sm:pb-12 sm:pt-24 md:min-h-[28rem] md:pb-14 md:pt-28 lg:min-h-[30rem]">
        <div className="flex w-full flex-col justify-end gap-4 sm:gap-8">
          <div className="max-w-[44rem]">
            <div className="mb-4 hidden w-fit max-w-full items-center gap-2 rounded-full border border-primary/20 bg-gradient-to-br from-primary/20 to-primary/10 px-4 py-2 text-[0.78rem] font-semibold uppercase tracking-[0.2em] text-[hsl(40_100%_96%)] shadow-[0_18px_30px_-24px_rgba(15,23,42,0.95)] backdrop-blur-md sm:inline-flex">
              {eyebrow}
            </div>
            <h1 className={cn(
              "max-w-[36rem] font-display text-[2.15rem] font-extrabold leading-[0.98] tracking-[-0.04em] text-[hsl(40_33%_97%)] [text-shadow:0_14px_34px_rgba(15,23,42,0.46)] sm:text-[2.55rem] md:text-[3.5rem] lg:text-[4.2rem]",
              titleClassName,
            )}>
              {title}
            </h1>
            {description ? (
              <p className="mt-3 line-clamp-2 max-w-[36rem] text-sm leading-6 text-[hsl(40_24%_90%_/_0.94)] [text-shadow:0_8px_24px_rgba(15,23,42,0.34)] sm:mt-4 sm:text-[1rem] sm:leading-[1.7] md:text-[1.06rem]">
                {description}
              </p>
            ) : null}

            {badges.length ? (
              <div className="mt-6 hidden flex-wrap gap-2 sm:flex">
                {badges.map((badge) => (
                  <span
                    key={badge}
                    className="rounded-full border border-white/12 bg-[hsl(220_18%_18%_/_0.88)] px-3 py-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[hsl(40_22%_92%)] shadow-[0_16px_26px_-22px_rgba(15,23,42,1)]"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {stats.length || action ? (
            <div className="hidden w-full flex-col gap-4 sm:flex lg:flex-row lg:items-end lg:justify-between">
              {stats.length ? (
                <div className="flex flex-wrap gap-3">
                  {stats.map((stat) => (
                    <div
                      key={stat.label}
                      className={cn(
                        "flex items-center border border-white/10 bg-[linear-gradient(180deg,hsl(220_18%_17%_/_0.74),hsl(220_18%_10%_/_0.52))] text-white shadow-[0_22px_42px_-24px_rgba(15,23,42,0.98)] backdrop-blur-[18px]",
                        statsDensity === "compact"
                          ? "min-w-[8.5rem] gap-2 rounded-2xl px-3 py-2"
                          : "min-w-[10.5rem] gap-3 rounded-[22px] px-4 py-3",
                      )}
                    >
                      <div className={cn(
                        "flex shrink-0 items-center justify-center border border-white/8 bg-[linear-gradient(180deg,hsl(24_100%_48%_/_0.18),hsl(220_18%_18%_/_0.18))]",
                        statsDensity === "compact" ? "h-7 w-7 rounded-lg" : "h-9 w-9 rounded-xl",
                      )}>
                        <stat.icon className={cn(statsDensity === "compact" ? "h-3.5 w-3.5" : "h-4.5 w-4.5", "text-white", stat.toneClassName)} />
                      </div>
                      <div>
                        <div className={cn(
                          "font-display font-black leading-none tracking-[-0.03em] text-[hsl(40_30%_97%)]",
                          statsDensity === "compact" ? "text-base" : "text-xl",
                        )}>
                          {stat.value}
                        </div>
                        <div className={cn(
                          "font-semibold uppercase text-[hsl(40_15%_78%_/_0.84)]",
                          statsDensity === "compact" ? "mt-0.5 text-[0.58rem] tracking-[0.13em]" : "mt-1 text-[0.68rem] tracking-[0.16em]",
                        )}>
                          {stat.label}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div />
              )}

              {action ? (
                <div className="flex lg:justify-end">
                  {actionLinkMode === "document" ? (
                    <a
                      href={action.to}
                      className="inline-flex items-center gap-2 rounded-full border border-primary/70 bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[0_24px_44px_-26px_rgba(15,23,42,0.98)] transition-all hover:-translate-y-0.5 hover:bg-[hsl(var(--primary)/0.92)] hover:shadow-glow"
                    >
                      <Plus className="h-4 w-4" />
                      {action.label}
                    </a>
                  ) : (
                    <Link
                      to={action.to}
                      className="inline-flex items-center gap-2 rounded-full border border-primary/70 bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[0_24px_44px_-26px_rgba(15,23,42,0.98)] transition-all hover:-translate-y-0.5 hover:bg-[hsl(var(--primary)/0.92)] hover:shadow-glow"
                    >
                      <Plus className="h-4 w-4" />
                      {action.label}
                    </Link>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <HeroMountainDivider />
    </section>
  );
}
