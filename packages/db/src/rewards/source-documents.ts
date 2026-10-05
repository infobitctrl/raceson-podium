import { RewardLedgerStoreError } from "./programme-ledger.js";
function demand(value: unknown): asserts value { if (!value) throw new RewardLedgerStoreError("invalid_reward_source_document"); }
// Source JSON legitimately includes fractional classification age rules. It is
// not an integer-only ledger payload. Preserve finite JSON numbers here; the
// source adapter validates/scales them and monetary decoders still demand strings.
export function copyRewardSourceDocument(input: unknown): unknown {
  let nodes = 0; const ancestors = new Set<object>();
  function copy(v: unknown, depth: number): unknown {
    demand(depth <= 32 && ++nodes <= 1_000_000);
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") { demand(Number.isFinite(v)); return v; }
    demand(typeof v === "object" && v !== null && !ancestors.has(v)
      && (Array.isArray(v) || [null, Object.prototype].includes(Object.getPrototypeOf(v))));
    const fields = Object.getOwnPropertyDescriptors(v); demand(!Object.getOwnPropertySymbols(v).length); ancestors.add(v);
    let result: unknown;
    if (Array.isArray(v)) {
      demand(Object.keys(fields).length === v.length + 1);
      result = Array.from({ length: v.length }, (_, i) => { demand(fields[i]?.enumerable && "value" in fields[i]); return copy(fields[i].value, depth + 1); });
    } else result = Object.fromEntries(Object.entries(fields).map(([key, field]) => {
      demand(field.enumerable && "value" in field); return [key, copy(field.value, depth + 1)];
    }));
    ancestors.delete(v); return result;
  }
  const result = copy(input, 0); demand(new TextEncoder().encode(JSON.stringify(result)).length <= 16_777_216); return result;
}
