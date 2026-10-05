import { useId } from "react";
import { Flag, Repeat2 } from "lucide-react";
import { useI18n } from "@/shared/i18n/I18nContext";
import { formatEventDistanceKm } from "../model/eventInfoPresentation";
import { raceCourseLaps, type RaceCourse } from "../model/raceCourse";

export function RaceCourseProgression({ course, isLoading, hasError }: {
  course?: RaceCourse;
  isLoading: boolean;
  hasError: boolean;
}) {
  const { t, localeTag } = useI18n();
  const titleId = useId();
  const laps = course ? raceCourseLaps(course) : [];
  const distance = (km: number | null) => km == null ? t("event.course.distancePending") : `${formatEventDistanceKm(km, localeTag)} km`;

  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-primary/25 bg-card p-4 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={titleId} className="flex items-center gap-2 font-display text-lg font-black">
          <Repeat2 className="h-5 w-5 text-primary" aria-hidden="true" />
          {t("event.course.title")}
        </h3>
        {course?.format ? <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{t(course.format === "laps" ? "event.course.lapCourse" : "event.course.singleCourse")}</span> : null}
      </div>
      {isLoading || hasError || !course?.format || (course.format === "laps" && !laps.length) ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">{t(isLoading ? "event.course.loading" : hasError ? "event.course.error" : "event.course.pending")}</p>
      ) : laps.length ? (
        <>
          <p className="mt-3 font-display text-xl font-black">{t("event.course.formula", { count: laps.length, distance: distance(laps[0].distanceKm), total: distance(course.distanceKm) })}</p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t("event.course.explanation", { count: laps.length })}</p>
          <ol tabIndex={0} aria-label={t("event.course.sequence")} className="mt-4 flex gap-3 overflow-x-auto rounded-xl pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <li className="min-w-32 flex-1 rounded-xl border border-border bg-background p-3">
              <div className="text-xs font-bold text-primary">{t("event.course.start")}</div>
              <div className="mt-2 font-mono text-sm font-bold">{distance(0)}</div>
            </li>
            {laps.map((lap) => (
              <li key={lap.number} className="min-w-40 flex-1 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
                <div className="flex items-center gap-2 text-xs font-bold text-primary">
                  {t("event.course.lap", { number: lap.number, count: laps.length })}
                  {lap.isFinish ? <Flag className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                </div>
                <div className="mt-2 font-mono text-sm font-bold">{distance(lap.cumulativeDistanceKm)}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t(lap.isFinish ? "event.course.finish" : "event.course.continue")}</div>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("event.course.courseNotLive")}</p>
        </>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("event.course.singleExplanation", { distance: distance(course.distanceKm) })}</p>
      )}
    </section>
  );
}
