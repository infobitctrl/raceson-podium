import type { PublicEventHeroShellData } from "@/features/public-metadata/model/publicPortalMetadata";
import { PublicEventInitialSummary } from "./PublicEventInitialData";
import { AlertCircle, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

import { useI18n } from "@/shared/i18n/I18nContext";

type EventDetailAvailabilityStateProps = {
  eventsPath: string;
  initialEvent?: PublicEventHeroShellData | null;
  fetching?: boolean;
  onRetry?: () => void;
  state: "error" | "unavailable";
};

export function EventDetailAvailabilityState({
  eventsPath,
  initialEvent,
  fetching = false,
  onRetry,
  state,
}: EventDetailAvailabilityStateProps) {
  const { t } = useI18n();
  const isError = state === "error";

  return (
    <div data-event-detail-ready className="container mx-auto px-4 py-16">
      {isError && initialEvent ? <PublicEventInitialSummary data={initialEvent} /> : null}
      <div
        data-nosnippet=""
        className="rounded-2xl border border-dashed border-border bg-card p-10 text-center"
        role={isError ? "alert" : undefined}
      >
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <h2 className="mt-4 font-display text-2xl font-bold">
          {t(isError ? "event.detail.loadErrorTitle" : "event.detail.unavailableTitle")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(isError ? "event.detail.loadErrorDescription" : "event.detail.unavailableDescription")}
        </p>
        {isError ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={fetching}
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {fetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t("common.tryAgain")}
          </button>
        ) : (
          <Link
            to={eventsPath}
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            {t("event.detail.backToEvents")}
          </Link>
        )}
      </div>
    </div>
  );
}
