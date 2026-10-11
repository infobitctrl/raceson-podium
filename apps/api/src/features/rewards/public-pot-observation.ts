import {decodeSponsorExecutionPlan, type SponsorExecutionPlan} from '@raceson/domain/rewards/sponsor-execution';
import {observePublicSponsorProgramme, observePublicSponsorProgrammePot, type SponsorChainObservation, type SponsorChainReader} from '@raceson/rewards-chain/sponsor-v4';
import type {Hex} from 'viem';

const RETENTION_MS = 120_000, MAX_SNAPSHOTS = 64;
type Entry = {until: number; value: Promise<SponsorChainObservation>};

/** Only public pagination may reuse an observation at an exact finalized block.
 * Fresh requests, private actions and reward-row verification bypass this store. */
export function createPublicPotObserver(observe = observePublicSponsorProgrammePot, now = Date.now, programme = observePublicSponsorProgramme) {
  const readers = new WeakMap<SponsorChainReader, Map<string, Entry>>();
  const scope = (plan: SponsorExecutionPlan, deployment: Hex, funding: Hex, slot: number) => JSON.stringify([plan, deployment, funding, slot]);
  const store = (reader: SponsorChainReader) => {
    let entries = readers.get(reader);
    if (!entries) {entries = new Map(); readers.set(reader, entries);}
    for (const [key, entry] of entries) if (entry.until <= now()) entries.delete(key);
    return entries;
  };
  const remember = (entries: Map<string, Entry>, key: string, entry: Entry) => {
    entries.delete(key);
    while (entries.size >= MAX_SNAPSHOTS) entries.delete(entries.keys().next().value!);
    entries.set(key, entry);
  };
  const read = async (reader: SponsorChainReader, input: SponsorExecutionPlan, deployment: Hex, funding: Hex, slot: number, block?: bigint) => {
    const plan = decodeSponsorExecutionPlan(input), entries = store(reader);
    const key = `${scope(plan, deployment, funding, slot)}:${block}`;
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
    if (block !== undefined) remember(entries, key, entry);
    try {
      const value = await entry.value;
      entry.until = now() + RETENTION_MS;
      // Keep caller mutations out of a later page's observation.
      entry.value = Promise.resolve(structuredClone(value));
      remember(entries, `${scope(plan, deployment, funding, slot)}:${value.blockNumber}`, entry);
      return value;
    } catch (error) {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    }
  };
  return Object.assign(read, {
    // Only the public campaign GET calls this fresh, complete observer. Seed
    // selected-pot snapshots internally; never accept observations from clients.
    programme: async (reader: SponsorChainReader, input: SponsorExecutionPlan, deployment: Hex, funding: Hex) => {
      const plan = decodeSponsorExecutionPlan(input);
      const value = await programme(reader, plan, deployment, funding);
      const entries = store(reader);
      for (const pot of value.pots) remember(entries, `${scope(plan, deployment, funding, pot.slot)}:${value.blockNumber}`, {
        until: now() + RETENTION_MS, value: Promise.resolve(structuredClone({...value, pots: [pot]})),
      });
      return value;
    },
  });
}

export const observePublicPot = createPublicPotObserver();
