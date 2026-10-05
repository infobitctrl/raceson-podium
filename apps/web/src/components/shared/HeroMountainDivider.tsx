type HeroMountainDividerProps = {
  className?: string;
};

export default function HeroMountainDivider({ className }: HeroMountainDividerProps) {
  return (
    <div className={className ?? "absolute bottom-0 left-0 right-0 z-10"}>
      <svg
        viewBox="0 0 1440 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-[34px] w-full md:h-[58px]"
        preserveAspectRatio="none"
      >
        <path
          d="M0 120V80L60 65L120 78L200 45L280 70L340 35L420 55L480 25L560 60L640 15L720 50L780 30L860 55L920 20L1000 48L1060 28L1120 52L1200 10L1280 42L1340 22L1400 50L1440 35V120H0Z"
          className="fill-background"
        />
        <path
          d="M0 120V90L80 72L160 85L240 55L320 75L380 42L460 62L540 32L620 68L700 22L780 58L840 38L920 62L980 28L1060 55L1140 35L1200 58L1280 18L1360 48L1440 42V120H0Z"
          className="fill-background/60"
        />
      </svg>
    </div>
  );
}
