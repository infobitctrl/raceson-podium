export const PLATFORM_SPORTS = [
  {
    code: "running",
    label: "Running",
    eventLabel: "Running races",
  },
  {
    code: "cycling",
    label: "Cycling",
    eventLabel: "Cycling races",
  },
  {
    code: "swimming",
    label: "Swimming",
    eventLabel: "Swimming races",
  },
  {
    code: "triathlon",
    label: "Triathlon",
    eventLabel: "Triathlon races",
  },
] as const;

export type PlatformSportCode = (typeof PLATFORM_SPORTS)[number]["code"];
