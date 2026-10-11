import {decodeSponsorExecutionPlan, type SponsorExecutionPlan} from '@raceson/domain/rewards/sponsor-execution';
import {observePublicSponsorProgrammePot, type SponsorChainObservation, type SponsorChainReader} from '@raceson/rewards-chain/sponsor-v4';
import type {Hex} from 'viem';

const RETENTION_MS = 120_000, MAX_SNAPSHOTS = 64;
type Entry = {until: number; value: Promise<SponsorChainObservation>};

/** Only public pagination may reuse an observation at an exact finalized block.
 * Fresh requests, private actions and reward-row verification bypass this store. */
export function createPublicPotObserver(observe = observePublicSponsorProgrammePot, now = Date.now) {
  const readers = new WeakMap<SponsorChainReader, Map<string, Entry>>();
  return async (reader: SponsorChainReader, input: SponsorExecutionPlan, deployment: Hex, funding: Hex, slot: number, block?: bigint) => {
    const plan = decodeSponsorExecutionPlan(input);
    const scope = JSON.stringify([plan, deployment, funding, slot]);
    let entries = readers.get(reader);
    if (!entries) {entries = new Map(); readers.set(reader, entries);}
    for (const [key, entry] of entries) if (entry.until <= now()) entries.delete(key);
    const remember = (key: string, entry: Entry) => {
      entries!.delete(key);
      while (entries!.size >= MAX_SNAPSHOTS) entries!.delete(entries!.keys().next().value!);
      entries!.set(key, entry);
    };
    const key = `${scope}:${block}`;
    const existing = block === undefined ? undefined : entries.get(key);
    if (existing) {
      try {
        const value = await existing.value;
        // Never cache these checks: provider/network changes must fail closed.
        const [chainId, finalized, canonical] = await Promise.all([
          reader.getChainId(), reader.getBlock({blockTag: 'finalized'}), reader.getBlock({blockNumber: block!}),
        ]);
        if (chainId !== plan.chainId || finalized.number === null || finalized.hash === null || finalized.number < block!
          || canonical.number !== block || canonical.hash !== value.blockHash || canonical.timestamp.toString() !== value.blockTimestamp)
          throw Error('public_awards_unavailable');
        return structuredClone(value);
      } catch (error) {
        if (entries.get(key) === existing) entries.delete(key);
        throw error;
      }
    }
    const entry: Entry = {until: now() + RETENTION_MS, value: observe(reader, plan, deployment, funding, slot, block)};
    if (block !== undefined) remember(key, entry);
    try {
      const value = await entry.value;
      entry.until = now() + RETENTION_MS;
      // Keep caller mutations out of a later page's observation.
      entry.value = Promise.resolve(structuredClone(value));
      remember(`${scope}:${value.blockNumber}`, entry);
      return value;
    } catch (error) {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    }
  };
}

export const observePublicPot = createPublicPotObserver();
