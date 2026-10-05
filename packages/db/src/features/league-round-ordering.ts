import { orderLeagueRoundsChronologically } from "@raceson/domain/leagues";
import { createAdminSupabaseClient } from "../supabase.js";

type AdminSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;

type StoredRound = {
  id: string;
  event_edition_id: string;
  round_number: number;
};

function isSchemaCompatError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string; details?: string };
  const message = `${record.message ?? ""} ${record.details ?? ""}`.toLowerCase();
  return (
    record.code === "42P01"
    || record.code === "PGRST204"
    || record.code === "PGRST205"
    || message.includes("does not exist")
    || message.includes("could not find the")
  );
}

async function persistRoundOrder(
  adminClient: AdminSupabaseClient,
  table: "league_round_events" | "league_rounds",
  rounds: StoredRound[],
  eventDateByEditionId: Map<string, string>,
) {
  const orderedRounds = orderLeagueRoundsChronologically(rounds.map((round) => ({
    id: round.id,
    eventEditionId: round.event_edition_id,
    eventDate: eventDateByEditionId.get(round.event_edition_id) ?? null,
    roundNumber: round.round_number,
  })));
  const currentRoundNumberById = new Map(
    rounds.map((round) => [round.id, round.round_number]),
  );
  if (orderedRounds.every((round) => (
    currentRoundNumberById.get(round.id) === round.roundNumber
  ))) return;

  const temporaryBase = Math.max(
    rounds.length,
    ...rounds.map((round) => round.round_number),
  ) + rounds.length + 1;

  for (const [index, round] of orderedRounds.entries()) {
    const { error } = await adminClient
      .from(table)
      .update({ round_number: temporaryBase + index })
      .eq("id", round.id);
    if (error) throw error;
  }

  for (const round of orderedRounds) {
    const { error } = await adminClient
      .from(table)
      .update({ round_number: round.roundNumber })
      .eq("id", round.id);
    if (error) throw error;
  }
}

export async function reorderOrganizerLeagueRoundsChronologically(
  adminClient: AdminSupabaseClient,
  seasonId: string,
) {
  const [roundResponse, legacyRoundResponse] = await Promise.all([
    adminClient
      .from("league_round_events")
      .select("id,event_edition_id,round_number")
      .eq("league_season_id", seasonId)
      .returns<StoredRound[]>(),
    adminClient
      .from("league_rounds")
      .select("id,event_edition_id,round_number")
      .eq("league_season_id", seasonId)
      .returns<StoredRound[]>(),
  ]);
  if (roundResponse.error && !isSchemaCompatError(roundResponse.error)) {
    throw roundResponse.error;
  }
  if (legacyRoundResponse.error) throw legacyRoundResponse.error;

  const rounds = roundResponse.data ?? [];
  const legacyRounds = legacyRoundResponse.data ?? [];
  const eventEditionIds = Array.from(new Set(
    [...rounds, ...legacyRounds].map((round) => round.event_edition_id),
  ));
  const editionResponse = eventEditionIds.length
    ? await adminClient
        .from("event_editions")
        .select("id,start_date")
        .in("id", eventEditionIds)
        .returns<Array<{ id: string; start_date: string }>>()
    : { data: [] as Array<{ id: string; start_date: string }>, error: null };
  if (editionResponse.error) throw editionResponse.error;

  const eventDateByEditionId = new Map(
    (editionResponse.data ?? []).map((edition) => [edition.id, edition.start_date]),
  );
  if (rounds.length) {
    await persistRoundOrder(adminClient, "league_round_events", rounds, eventDateByEditionId);
  }
  if (legacyRounds.length) {
    await persistRoundOrder(adminClient, "league_rounds", legacyRounds, eventDateByEditionId);
  }
}
