export type CalendarTimelineAccent = {
  rail: string;
  line: string;
  monthLabel: string;
  monthSubtle: string;
  dot: string;
  dateFrame: string;
  dateTop: string;
  dateBody: string;
  dateDay: string;
  stripe: string;
  cardTint: string;
  metaTint: string;
};

export const calendarTimelineAccents: CalendarTimelineAccent[] = [
  {
    rail: "bg-primary",
    line: "bg-primary/15",
    monthLabel: "text-primary",
    monthSubtle: "text-primary/80",
    dot: "bg-primary/55",
    dateFrame: "border-primary/20 bg-card",
    dateTop: "bg-primary text-primary-foreground",
    dateBody: "bg-primary/[0.05]",
    dateDay: "text-primary",
    stripe: "bg-primary",
    cardTint: "bg-primary/[0.03]",
    metaTint: "bg-primary/[0.04]",
  },
  {
    rail: "bg-trail-blue",
    line: "bg-trail-blue/15",
    monthLabel: "text-trail-blue",
    monthSubtle: "text-trail-blue/80",
    dot: "bg-trail-blue/55",
    dateFrame: "border-trail-blue/20 bg-card",
    dateTop: "bg-trail-blue text-white dark:text-trail-blue-foreground",
    dateBody: "bg-trail-blue/[0.06]",
    dateDay: "text-trail-blue",
    stripe: "bg-trail-blue",
    cardTint: "bg-trail-blue/[0.03]",
    metaTint: "bg-trail-blue/[0.05]",
  },
  {
    rail: "bg-trail-green",
    line: "bg-trail-green/15",
    monthLabel: "text-trail-green",
    monthSubtle: "text-trail-green/80",
    dot: "bg-trail-green/55",
    dateFrame: "border-trail-green/20 bg-card",
    dateTop: "bg-trail-green text-trail-green-foreground",
    dateBody: "bg-trail-green/[0.06]",
    dateDay: "text-trail-green",
    stripe: "bg-trail-green",
    cardTint: "bg-trail-green/[0.03]",
    metaTint: "bg-trail-green/[0.05]",
  },
  {
    rail: "bg-trail-amber",
    line: "bg-trail-amber/15",
    monthLabel: "text-trail-amber",
    monthSubtle: "text-trail-amber/80",
    dot: "bg-trail-amber/55",
    dateFrame: "border-trail-amber/20 bg-card",
    dateTop: "bg-trail-amber text-trail-amber-foreground",
    dateBody: "bg-trail-amber/[0.08]",
    dateDay: "text-trail-amber",
    stripe: "bg-trail-amber",
    cardTint: "bg-trail-amber/[0.03]",
    metaTint: "bg-trail-amber/[0.06]",
  },
];

export const finishedCalendarTimelineAccent: CalendarTimelineAccent = {
  rail: "bg-muted-foreground/35",
  line: "bg-border",
  monthLabel: "text-muted-foreground",
  monthSubtle: "text-muted-foreground",
  dot: "bg-muted-foreground/45",
  dateFrame: "border-border bg-card",
  dateTop: "bg-muted text-muted-foreground",
  dateBody: "bg-muted/70",
  dateDay: "text-foreground/75",
  stripe: "bg-border",
  cardTint: "bg-muted/40",
  metaTint: "bg-muted/60",
};

export function pickCalendarTimelineAccent(dateValue: Date | null, isFinished: boolean) {
  if (isFinished) return finishedCalendarTimelineAccent;
  if (!dateValue) return calendarTimelineAccents[0];
  return calendarTimelineAccents[dateValue.getMonth() % calendarTimelineAccents.length];
}
