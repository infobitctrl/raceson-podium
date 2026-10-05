export const EVENT_ACTIVITY_TYPES = [
  "race",
  "training",
  "recreational",
  "club_activity",
  "community",
] as const;

export type EventActivityType = (typeof EVENT_ACTIVITY_TYPES)[number];

export type EventActivityTypeDefinition = {
  code: EventActivityType;
  label: string;
  description: string;
};

export const DEFAULT_EVENT_ACTIVITY_TYPE: EventActivityType = "race";

export const EVENT_ACTIVITY_TYPE_DEFINITIONS: readonly EventActivityTypeDefinition[] = [
  {
    code: "race",
    label: "Race",
    description: "A timed or ranked competitive race.",
  },
  {
    code: "training",
    label: "Training",
    description: "A coached, structured, or practice session.",
  },
  {
    code: "recreational",
    label: "Recreational activity",
    description: "A participation-first activity without competitive emphasis.",
  },
  {
    code: "club_activity",
    label: "Club activity",
    description: "A session or outing intended primarily for club members.",
  },
  {
    code: "community",
    label: "Community activity",
    description: "A social, charity, volunteer, or community gathering.",
  },
] as const;

const eventActivityTypeSet = new Set<string>(EVENT_ACTIVITY_TYPES);

export function isEventActivityType(value: unknown): value is EventActivityType {
  return typeof value === "string" && eventActivityTypeSet.has(value);
}

export function normalizeEventActivityType(value: unknown): EventActivityType {
  return isEventActivityType(value) ? value : DEFAULT_EVENT_ACTIVITY_TYPE;
}
