import type { QueryClient } from "@tanstack/react-query";
import {
  queryKeyMatchesPlatformInvalidation,
  queryPrefixesForInvalidationFamilies,
} from "@/shared/realtime/platformInvalidation";

const finishQueryPrefixes = queryPrefixesForInvalidationFamilies([
  "event", "results", "league", "organizer", "homepage",
]);

/** Refresh the submitting browser immediately; other clients use the server broadcast. */
export function refreshRaceFinish(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => queryKeyMatchesPlatformInvalidation(query.queryKey, finishQueryPrefixes),
  }, { throwOnError: true });
}
