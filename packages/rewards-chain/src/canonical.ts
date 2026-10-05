import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import { bytes32, demand } from "./validation.js";

/** RacesOn-specific canonical JSON v1, NOT RFC 8785. Typed financial readers must
 *  parse their known integer-string fields explicitly; no global JSON reviver.
 *  Reject getters, custom prototypes, sparse arrays and unsafe numbers rather than
 *  executing serializers or silently losing evidence during JSON persistence. */
export function canonicalRewardJson(value: unknown): string {
  const active = new Set<object>();
  let nodes = 0;
  function visit(item: unknown, depth: number): string {
    demand(++nodes <= 100_000 && depth <= 32, "reward_document_too_complex");
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "bigint") return JSON.stringify(item.toString());
    if (typeof item === "number") {
      demand(Number.isSafeInteger(item) && !Object.is(item, -0), "unsafe_reward_json_number");
      return String(item);
    }
    demand(typeof item === "object" && item !== null, "unsupported_reward_json_value");
    demand(!active.has(item), "cyclic_reward_document");
    demand(Object.getOwnPropertySymbols(item).length === 0, "unsupported_reward_json_property");
    active.add(item);
    let encoded: string;
    if (Array.isArray(item)) {
      demand(Object.getPrototypeOf(item) === Array.prototype && Object.getOwnPropertyNames(item).length === item.length + 1, "invalid_reward_json_array");
      const values: string[] = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        demand(descriptor && descriptor.enumerable && "value" in descriptor, "unsupported_reward_json_property");
        values.push(visit(descriptor.value, depth + 1));
      }
      encoded = `[${values.join(",")}]`;
    } else {
      demand(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null, "unsupported_reward_json_object");
      const keys = Object.getOwnPropertyNames(item).sort();
      encoded = `{${keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        demand(descriptor.enumerable && "value" in descriptor, "unsupported_reward_json_property");
        return `${JSON.stringify(key)}:${visit(descriptor.value, depth + 1)}`;
      }).join(",")}}`;
    }
    active.delete(item);
    return encoded;
  }
  const result = visit(value, 0);
  demand(new TextEncoder().encode(result).length <= 8 * 1024 * 1024, "reward_document_too_large");
  return result;
}

/** Salt must be fresh cryptographic randomness persisted privately by the server,
 *  not a wallet secret, public UUID, recipient address or hash of predictable PII. */
export function commitPrivateRewardDocument(purpose: "snapshot" | "explanation", document: unknown, salt: Hex): Hex {
  demand(purpose === "snapshot" || purpose === "explanation", "invalid_reward_commitment_purpose");
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "bytes32" }, { type: "bytes32" }],
    [`raceson-rewards-json-v1:${purpose}`, bytes32(salt), keccak256(stringToHex(canonicalRewardJson(document)))],
  ));
}

/** Only public programme rules belong here. Identity/result evidence uses salted commitments. */
export function hashPublicRewardRules(document: unknown): Hex {
  return keccak256(encodeAbiParameters([{ type: "string" }, { type: "string" }], ["raceson-public-reward-rules-v1", canonicalRewardJson(document)]));
}
