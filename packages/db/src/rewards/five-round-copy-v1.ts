import { createHash, timingSafeEqual } from "node:crypto";
import { decodeFiveRoundCopyV1, type FiveRoundCopyV1 } from "@raceson/domain/rewards/five-round-copy-v1";

/** Deterministic object encoding; array order is part of the frozen projection. */
export function fiveRoundCopyProjectionHashV1(value: unknown): string {
  function canonical(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (v !== null && typeof v === "object") return `{${Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
    if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    throw new Error("invalid_copy_projection");
  }
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export type FiveRoundCopyPinV1 = { batchSha256: string; projectionSha256: string; leagueId: string; seasonId: string };
/** Pin comes from the reviewed export, never from the same live response or browser.
 * Reader is operator-injected: no default service-role client, broad grant or route. */
export async function readFiveRoundCopyV1(pin: FiveRoundCopyPinV1, read: (batchSha256: string) => Promise<unknown>): Promise<FiveRoundCopyV1> {
  if (!/^[0-9a-f]{64}$/.test(pin.batchSha256) || !/^[0-9a-f]{64}$/.test(pin.projectionSha256)) throw new Error("invalid_copy_pin");
  const value = await read(pin.batchSha256);
  const digest = fiveRoundCopyProjectionHashV1(value);
  if (!timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(pin.projectionSha256, "hex"))) throw new Error("copy_projection_changed");
  const source = decodeFiveRoundCopyV1(value);
  if (source.batchSha256 !== pin.batchSha256 || source.leagueId !== pin.leagueId || source.seasonId !== pin.seasonId) throw new Error("copy_scope_changed");
  return source;
}
