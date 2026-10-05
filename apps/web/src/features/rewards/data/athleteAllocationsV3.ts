import { decodeAthleteAllocationsV3 } from "@raceson/domain/rewards/athlete-allocations-v3";
import { apiRequest } from "@/lib/api";

export async function getOwnAllocationsV3(after: string | null = null) {
  const query = after === null ? "" : `?after=${encodeURIComponent(after)}`;
  const body = await apiRequest<unknown>({ path: `/v1/athlete/rewards/programme-allocations-v3${query}`, cache: "no-store" });
  return decodeAthleteAllocationsV3(body, undefined, after);
}
