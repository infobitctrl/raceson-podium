import { AlertTriangle, WifiOff, X } from "lucide-react";

export type TimingEntryAlert = {
  id: string;
  tone: "error" | "warning" | "offline";
  title: string;
  message: string;
};

export default function TimingEntryAlerts({
  alerts,
  onDismiss,
}: {
  alerts: TimingEntryAlert[];
  onDismiss: (id: string) => void;
}) {
  if (!alerts.length) return null;

  return (
    <div className="mt-3 space-y-2" aria-label="Timing entry alerts">
      {alerts.map((alert) => {
        const isError = alert.tone === "error";
        return (
          <div
            key={alert.id}
            role="alert"
            aria-live={isError ? "assertive" : "polite"}
            className={`flex items-start gap-3 rounded-xl border-2 px-3 py-3 text-left shadow-sm sm:px-4 ${
              isError
                ? "border-destructive bg-destructive/10 text-destructive"
                : "border-trail-amber/60 bg-trail-amber/10 text-foreground"
            }`}
          >
            {alert.tone === "offline" ? (
              <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-trail-amber" aria-hidden="true" />
            ) : (
              <AlertTriangle
                className={`mt-0.5 h-5 w-5 shrink-0 ${isError ? "text-destructive" : "text-trail-amber"}`}
                aria-hidden="true"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-5">{alert.title}</p>
              <p className={`mt-0.5 text-xs font-medium leading-5 sm:text-sm ${
                isError ? "text-destructive" : "text-muted-foreground"
              }`}>
                {alert.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(alert.id)}
              aria-label={`Dismiss ${alert.title}`}
              className="-mr-2 -mt-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
