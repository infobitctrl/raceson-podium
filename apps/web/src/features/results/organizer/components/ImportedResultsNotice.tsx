import { useI18n } from "@/shared/i18n/I18nContext";
import type { OrganizerCategoryResults } from "@/lib/organizer-management";

export function ImportedResultsNotice({ snapshot }: { snapshot: OrganizerCategoryResults }) {
  const { t } = useI18n();
  const published = snapshot.publication?.resultRunId === snapshot.selectedRun?.id
    && ["official", "corrected"].includes(snapshot.publication?.publicationState ?? "");
  return (
    <section aria-label={t("results.imported.title")} className="mb-4 rounded-xl border border-border bg-card p-4" role="status">
      <h2 className="text-sm font-bold">{t(published ? "results.imported.official" : "results.imported.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("results.imported.explanation")}</p>
      {published ? <p className="mt-1 text-sm text-muted-foreground">{t("results.imported.publicVersion")}</p> : null}
      <p className="mt-2 text-xs text-muted-foreground">{t("results.imported.corrections")}</p>
    </section>
  );
}
