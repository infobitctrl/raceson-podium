import { Link } from "react-router-dom";
import type { TrackRecordSourceKind } from "@/features/tracks/public/model/trackRecords";
import { cn } from "@/lib/utils";

type TrackRecordTimeLinkProps = {
  time: string;
  sourceKind: TrackRecordSourceKind;
  sourceLabel: string;
  sourceHref: string | null;
  className?: string;
};

export default function TrackRecordTimeLink({
  time,
  sourceKind,
  sourceLabel,
  sourceHref,
  className,
}: TrackRecordTimeLinkProps) {
  const linkClassName = cn(
    "inline-flex rounded-sm underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    className,
  );
  const accessibleLabel = `Open ${sourceLabel}: ${time}`;

  if (sourceKind === "strava" && sourceHref) {
    return (
      <a
        href={sourceHref}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName}
        aria-label={accessibleLabel}
      >
        {time}
      </a>
    );
  }

  if (sourceKind === "race" && sourceHref) {
    return (
      <Link to={sourceHref} className={linkClassName} aria-label={accessibleLabel}>
        {time}
      </Link>
    );
  }

  return <span className={className}>{time}</span>;
}
