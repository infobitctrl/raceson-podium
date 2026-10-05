import { Bike, Footprints, Waves, type LucideProps } from "lucide-react";
import type { PlatformSportCode } from "./platformSports";

function TriathlonIcon({ size = 24, ...props }: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="4" cy="5" r="1.25" />
      <path d="m1.75 9 2.1-1.35 2.4 1.2M1.5 11.5c1.1-.8 2.2-.8 3.3 0 1.1.8 2.2.8 3.3 0" />
      <circle cx="11" cy="17.25" r="2.1" />
      <circle cx="17" cy="17.25" r="2.1" />
      <path d="m11 17.25 2.4-4.4 2.1 4.4m-3.6-2.8h3.1m-1.6-1.6h2.25" />
      <circle cx="19" cy="5" r="1.25" />
      <path d="m18.5 8 1.9 2.15-1.7 2.35m1.7-2.35 2.1-.4m-3.8 2.75-1.9 2.25" />
    </svg>
  );
}

export function PlatformSportIcon({
  sport,
  ...props
}: LucideProps & { sport: PlatformSportCode }) {
  if (sport === "running") return <Footprints {...props} />;
  if (sport === "cycling") return <Bike {...props} />;
  if (sport === "swimming") return <Waves {...props} />;
  return <TriathlonIcon {...props} />;
}
