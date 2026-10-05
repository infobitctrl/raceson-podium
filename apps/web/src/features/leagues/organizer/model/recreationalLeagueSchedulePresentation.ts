import type { SportCode } from "@raceson/domain/sports";

type RecurringLeagueBaseEventContext = {
  seasonStartsOn?: string | null;
  seasonEndsOn?: string | null;
  roundOneEventId?: string | null;
};

export function getDayAfterIsoDate(date: string) {
  const nextDate = new Date(`${date}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate.toISOString().slice(0, 10);
}

export function getRecurringLeagueCopyDateIssue(
  roundOneDate: string,
  validFrom: string,
  validUntil: string,
  latestExistingRoundDate?: string | null,
) {
  if (validFrom <= roundOneDate) {
    return "Generated rounds must start after the Round 1 race date";
  }
  if (latestExistingRoundDate && validFrom <= latestExistingRoundDate) {
    return `New recurring rounds must start after the latest existing league round (${latestExistingRoundDate})`;
  }
  if (validUntil < validFrom) {
    return "The generated-round end date must be on or after its start date";
  }
  return null;
}

export function getRecurringLeagueBaseEventIssue(
  event: {
    id: string;
    startDate: string;
    isPractice: boolean;
    isRecurrenceGenerated?: boolean;
    categories: Array<{
      sportCode: SportCode;
      trackTemplateId: string | null;
      trackVersionId: string | null;
    }>;
  },
  leagueSportCodes: readonly SportCode[],
  competitionCount: number,
  context: RecurringLeagueBaseEventContext = {},
) {
  if (event.isPractice) return "Practice races cannot be used as recurring base races";
  if (event.isRecurrenceGenerated) return "Generated recurring races cannot be used as base races";
  if (context.roundOneEventId && event.id !== context.roundOneEventId) {
    return "This season already has a different Round 1 race";
  }
  if (context.seasonStartsOn && event.startDate < context.seasonStartsOn) {
    return "The Round 1 race must be inside the league season";
  }
  if (context.seasonEndsOn && event.startDate > context.seasonEndsOn) {
    return "The Round 1 race must be inside the league season";
  }
  if (!event.categories.length) return "Add at least one race to the base race";
  if (competitionCount < 1) {
    return "Create at least one individual league competition";
  }
  if (event.categories.length < competitionCount) {
    return `The base race must contain at least ${competitionCount} race${competitionCount === 1 ? "" : "s"}`;
  }
  const allowedSports = new Set(leagueSportCodes);
  if (event.categories.some((category) => !allowedSports.has(category.sportCode))) {
    return "Every base-race sport must be enabled for this league";
  }
  if (event.categories.some((category) => !category.trackTemplateId || !category.trackVersionId)) {
    return "Every base-race must have a route assigned";
  }
  return null;
}

export function filterRecurringLeagueBaseEvents<
  T extends {
    id: string;
    startDate: string;
    isPractice: boolean;
    isRecurrenceGenerated?: boolean;
    categories: Array<{
      sportCode: SportCode;
      trackTemplateId: string | null;
      trackVersionId: string | null;
    }>;
  },
>(
  events: T[],
  leagueSportCodes: readonly SportCode[],
  competitionCount: number,
  context: RecurringLeagueBaseEventContext = {},
) {
  return events.filter((event) => (
    getRecurringLeagueBaseEventIssue(event, leagueSportCodes, competitionCount, context) === null
  ));
}
