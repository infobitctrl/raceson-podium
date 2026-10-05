import { hostedCopySelections, hostedCopyReviewNote } from "./hosted-copy-review.js";
import { createAdminSupabaseClient, type ServerEnv } from "@raceson/db";
import { readFiveRoundCopyV1, type FiveRoundCopyPinV1 } from "@raceson/db/rewards";
import { previewFiveRoundCopyV1 } from "@raceson/domain/rewards/five-round-copy-v1";
import type { RewardAccountIdentity } from "@raceson/db/rewards";

export const hostedCopyPin: FiveRoundCopyPinV1 = Object.freeze({
  batchSha256: "073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644",
  projectionSha256: "7043cf919edd4dc3bdf40d022c60d0fc40036f2e4093b33b57dfc040bda3975d",
  leagueId: "ba81ced7-b2c5-4d51-95b6-d95d8c04fa36", seasonId: "323d55fc-a396-4ff4-a17e-eb7152c8f8f1",
});
// Public display labels from this exact frozen copy, keyed by original sporting
// competition IDs. These are not new classifications or a scoring policy.
const competitionNames: Readonly<Record<string, string>> = Object.freeze({
  "38161390-0b72-48c8-b69b-ecd8cf85a800": "Long",
  "94ed9600-f238-4db1-a2af-0da319da60a3": "Short",
});
export function hostedCopyPreviewEnabled(values: Record<string, string | undefined>, env: Pick<ServerEnv, "supabaseUrl">) {
  if (!values.RACESON_REWARD_HOSTED_COPY_MODE) return false;
  if (!["preview-v1", "sponsor-drafts-v1"].includes(values.RACESON_REWARD_HOSTED_COPY_MODE) || values.RACESON_REWARD_PORTAL_MODE !== "testnet"
    || env.supabaseUrl !== "https://niklhlmljiikwbkrmapw.supabase.co") throw Error("hosted_copy_configuration_required");
  return true;
}
export function hostedCopyOperationsEnabled(values:Record<string,string|undefined>,env:Pick<ServerEnv,'supabaseUrl'>){
 if(!values.RACESON_REWARD_HOSTED_OPERATIONS)return false;
 if(values.RACESON_REWARD_HOSTED_OPERATIONS!=='testnet-v1'||values.RACESON_REWARD_HOSTED_COPY_MODE!=='sponsor-drafts-v1'
  ||!hostedCopyPreviewEnabled(values,env))throw Error('hosted_copy_configuration_required');
 return true;
}
const allowed = new Map([
  ["/api/v1/public/auth/sign-in", "POST"], ["/api/v1/public/auth/sign-out", "POST"],
  ["/api/v1/public/auth/session", "POST"], ["/api/v1/public/auth/refresh", "POST"],
  ["/api/v1/rewards/demo-copy/catalogue", "GET"], ["/api/v1/rewards/public-campaigns", "GET"],
  ["/api/v1/account/context", "GET"], ["/api/v1/rewards/demo-copy/preview", "GET"],
]);
/** First hosted slice permits ordinary sessions and this read only. In particular,
 * registration/recovery delivery, auto-bootstrap, provider tokens and signing stay closed. */
export function hostedCopyRequestAllowed(method: string | undefined, url: URL, mode = "preview-v1",operations=false) {
  if (mode === "sponsor-drafts-v1" && [...url.searchParams].length === 0) {
    if(operations&&url.pathname==='/api/v1/rewards/admin/wallets')return method==='GET'||method==='POST';
    if(operations&&url.pathname==='/api/v1/rewards/admin/wallets/creation')return method==='POST';
    if(operations&&/^\/api\/v1\/rewards\/(?:demo-copy\/sponsor-setups\/[0-9a-f-]{36}\/launch|distribution-setups\/[0-9a-f-]{36}\/execution)$/.test(url.pathname))return method==='GET'||method==='POST';
    if (["/api/v1/rewards/demo-copy/sponsor-source", "/api/v1/rewards/demo-copy/sponsor-setups"].includes(url.pathname)) return method === "GET";
    if (/^\/api\/v1\/rewards\/demo-copy\/sponsor-setups\/[0-9a-f-]{36}\/allocation\/[1-9][0-9]{0,9}(?:\/handoff)?$/.test(url.pathname)) return method === "GET";
    if (/^\/api\/v1\/rewards\/demo-copy\/sponsor-setups\/[0-9a-f-]{36}$/.test(url.pathname)) return method === "GET" || method === "PATCH";
  }
  return allowed.get(url.pathname) === method && [...url.searchParams].length === 0;
}
export async function readHostedCopyPreview(identity: RewardAccountIdentity, env: ServerEnv,
  rpc = (args: Record<string, string>) => createAdminSupabaseClient(env).rpc("service_reward_demo_copy_preview", args), pin = hostedCopyPin) {
  const { data, error } = await rpc({ p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId });
  if (error) {
    if (["reward_account_session_required", "reward_demo_account_required"].includes(error.message)) throw Error(error.message);
    throw Error("hosted_copy_unavailable");
  }
  const account = data?.account;
  if (!account || account.userId !== identity.userId || !["athlete", "sponsor"].includes(account.kind)
    || account.batchSha256 !== pin.batchSha256) throw Error("hosted_copy_unavailable");
  const source = await readFiveRoundCopyV1(pin, async () => data.source);
  if (account.kind === "athlete" ? !source.athletes.some(a => a.id === account.athleteId) : account.athleteId !== null) throw Error("hosted_copy_unavailable");
  const preview = previewFiveRoundCopyV1(source, hostedCopySelections(pin));
  // The public result is already pseudonymized. Strip Auth binding IDs, usernames,
  // batch data, provenance IDs and source rows the viewer does not need to inspect.
  return JSON.parse(JSON.stringify({
    version: "podium-hosted-copy-preview-v1", account: { kind: account.kind, athleteId: account.athleteId },
    combinedReview: hostedCopySelections(pin).length ? {note: hostedCopyReviewNote(pin), countedFinishes: preview.combinedFinishCount} : null,
    season: { name: "Šibenik Trail League · five-round demo", rounds: 5 },
    classifications: source.classifications.map(c => ({ id: c.id, name: c.name, competition: competitionNames[c.competitionId] ?? null })),
    ...{ state: preview.state, payableWei: preview.payableWei, counts: preview.counts, duplicateFinishSlots: preview.duplicateFinishSlots },
    tables: preview.tables.map(t => ({ ...t, candidates: t.candidates.map(({ evidenceIds, ...r }) => r) })),
    participation: preview.participation.map(p => ({ ...p, rows: p.rows.map(({ evidenceIds, ...r }) => ({ ...r, name: source.athletes.find(a => a.id === r.athleteId)!.name })) })),
    results: source.results.map(r => ({ id: r.id, name: source.athletes.find(a => a.id === r.athleteId)!.name,
      club: source.clubs.find(c => c.id === r.clubId)?.name ?? null, slot: source.races.find(x => x.id === r.raceId)!.slot,
      competition: competitionNames[source.races.find(x => x.id === r.raceId)!.competitionId] ?? null,
      status: r.status, finishTimeMs: r.finishTimeMs, rank: r.rankOverall, classificationIds: r.classificationIds })),
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}
