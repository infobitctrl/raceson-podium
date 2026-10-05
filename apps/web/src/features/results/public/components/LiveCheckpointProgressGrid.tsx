import type { PublicLiveEditionReadModel } from "@/lib/portal-read-models";

type LiveCheckpointProgress = PublicLiveEditionReadModel["categories"][number]["checkpointProgress"][number];

function checkpointLocalTime(value: string | null, timeZone: string) {
  if (!value) return "Not recorded";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Not recorded";

  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  };

  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(timestamp);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(timestamp);
  }
}

function checkpointRelativeTime(value: string | null, effectiveStartAt: string | null) {
  if (!value) return "Waiting for first pass";
  if (!effectiveStartAt) return "Start time unavailable";
  const timestamp = new Date(value);
  const start = new Date(effectiveStartAt);
  const elapsedMilliseconds = timestamp.getTime() - start.getTime();
  if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) {
    return "Relative time unavailable";
  }

  const totalSeconds = Math.round(elapsedMilliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `+${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `+${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function LiveCheckpointProgressGrid({
  checkpoints,
  timeZone,
  effectiveStartAt,
}: {
  checkpoints: LiveCheckpointProgress[];
  timeZone: string;
  effectiveStartAt: string | null;
}) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2" aria-label="Live control point progress">
      {checkpoints.map((checkpoint) => (
        <div key={checkpoint.id} className="rounded-2xl border border-border/70 bg-background/65 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">{checkpoint.name}</div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                {checkpoint.type.replace(/_/g, " ")}
              </div>
            </div>
            <span className="font-display text-2xl font-black text-primary" aria-label={`${checkpoint.observedCount} observations`}>
              {checkpoint.observedCount}
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3">
            <div className="min-w-0">
              <dt className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Local time</dt>
              <dd className="mt-1 truncate font-mono text-xs font-bold text-foreground">
                {checkpoint.lastObservationAt ? (
                  <time dateTime={checkpoint.lastObservationAt}>
                    {checkpointLocalTime(checkpoint.lastObservationAt, timeZone)}
                  </time>
                ) : "Not recorded"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Relative</dt>
              <dd className="mt-1 truncate text-xs font-semibold text-foreground">
                {checkpointRelativeTime(checkpoint.lastObservationAt, effectiveStartAt)}
              </dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}
