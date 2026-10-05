import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import type { PortalEventCategory } from "@/lib/portal-data";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getPublicEventCourses } from "../data/publicEventCourses";
import { localizedEventDistanceLabel } from "../model/eventInfoPresentation";
import { RaceCourseProgression } from "./RaceCourseProgression";

export function EventRaceInfo({ eventEditionId, categories, selectedCategory }: {
  eventEditionId?: string;
  categories: PortalEventCategory[];
  selectedCategory: PortalEventCategory | null;
}) {
  const { t, localeTag } = useI18n();
  const [searchParams] = useSearchParams();
  const courseQuery = useQuery({
    queryKey: ["public-event-courses", eventEditionId],
    queryFn: () => getPublicEventCourses(eventEditionId!),
    enabled: Boolean(eventEditionId),
    staleTime: 60_000,
  });

  return (
    <div className="mb-5 space-y-4 lg:mb-6">
      <nav aria-label={t("event.raceInfo.choose")} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {categories.map((category) => {
          const query = new URLSearchParams(searchParams);
          query.set("tab", "race-info");
          query.set("race", category.slug);
          return (
            <Link
              key={category.slug}
              to={{ search: `?${query}` }}
              aria-current={category.slug === selectedCategory?.slug ? "page" : undefined}
              className={cn("min-w-0 rounded-xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", category.slug === selectedCategory?.slug ? "border-primary/50 bg-primary/10" : "border-border bg-card hover:border-primary/30")}
            >
              <span className="block text-xs font-black text-primary">{localizedEventDistanceLabel(category.distance, localeTag)}</span>
              <span className="mt-1 block text-sm font-semibold">{category.name}</span>
            </Link>
          );
        })}
      </nav>
      <RaceCourseProgression course={courseQuery.data?.find((course) => course.categoryId === selectedCategory?.id)} isLoading={Boolean(eventEditionId) && courseQuery.isPending} hasError={courseQuery.isError} />
    </div>
  );
}
