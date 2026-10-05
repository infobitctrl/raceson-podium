export type EventEmailKey = "registration" | "reminder" | "results";

/** Saved content and automatic delivery timing, evaluated by the private worker. */
export type EventEmailSettings = {
  instructions: string;
  contactEmail: string;
  contactPhone: string;
  schedule: {
    mode: "registration" | "day_before" | "after_race";
    localTime: string;
    daysAfter: 0 | 1 | 2;
  };
};

export function isEventEmailSchedule(key: string, schedule: unknown): schedule is EventEmailSettings["schedule"] {
  if (!schedule || typeof schedule !== "object") return false;
  const value = schedule as Record<string, unknown>;
  if (typeof value.localTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.localTime)) return false;
  return key === "registration" ? value.mode === "registration" && value.daysAfter === 0
    : key === "reminder" ? value.mode === "day_before" && value.daysAfter === 0
    : key === "results" && value.mode === "after_race" && (value.daysAfter === 1 || value.daysAfter === 2);
}
export type SavedEventEmailSettings = {
  templateKey: EventEmailKey;
  settings: EventEmailSettings;
  updatedAt: string;
};
export type EventEmailConfiguration = {
  templates: SavedEventEmailSettings[];
  delivery?: { active: boolean; enabled: boolean; lastWorkerAt: string | null; attentionCount: number } | null;
  organizer: { contactEmail: string; contactPhone: string; socialLinks: { label: string; url: string }[] };
};
