import { decodeRewardSetup, decodeSavedRewardSetup, setupId } from '@raceson/domain/rewards/distribution-setup';
import { readFiveRoundCopyV1, type FiveRoundCopyPinV1 } from './five-round-copy-v1.js';
import type { RewardLedgerRpc } from './programme-ledger.js';
import type { RewardAccountIdentity } from './athlete-wallets.js';

export type HostedSponsorAction = 'template' | 'list' | 'read' | 'save';
export type HostedSponsorChange = { requestId: string; expectedRevision: number; configuration: unknown };
/** Only the copy-specific sponsor RPC receives authority. The original draft RPC stays revoked. */
export async function hostedCopySponsor(identity: RewardAccountIdentity, action: HostedSponsorAction, id: string | null,
 change: HostedSponsorChange | undefined, pin: FiveRoundCopyPinV1, rpc: RewardLedgerRpc) {
 if (!setupId(identity.userId) || !setupId(identity.sessionId) || (action === 'list' ? id !== null : !setupId(id))
  || (action === 'save') !== !!change || change && (!setupId(change.requestId) || !Number.isInteger(change.expectedRevision) || change.expectedRevision < 0 || change.expectedRevision > 2147483644)) throw Error('invalid_reward_setup');
 const configuration = change ? decodeRewardSetup(change.configuration) : null;
 const invoke = async (operation: HostedSponsorAction, fingerprint: string | null = null) => {
  const response = await rpc('service_reward_demo_copy_sponsor', {
   p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_action: operation, p_setup_id: id,
   p_request_id: operation === 'save' ? change!.requestId : null,
   p_expected_revision: operation === 'save' ? change!.expectedRevision : null,
   p_configuration: operation === 'save' ? configuration : null, p_source_fingerprint: fingerprint,
  });
  if (response.error) {
   const code = (response.error as { message?: string }).message;
   throw Error(code && ['reward_account_session_required','reward_demo_account_required','reward_demo_sponsor_required','reward_setup_not_found','reward_setup_conflict','reward_setup_limit','invalid_reward_setup','copy_scope_changed'].includes(code) ? code : 'hosted_copy_unavailable');
  }
  const data = response.data as { source?: unknown; sourceFingerprint?: unknown; result?: unknown } | null;
  if (!data || typeof data.sourceFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(data.sourceFingerprint)) throw Error('hosted_copy_unavailable');
  const source = await readFiveRoundCopyV1(pin, async () => data.source);
  return { source, fingerprint: data.sourceFingerprint, result: data.result };
 };
 // Verify the independently pinned projection BEFORE any write. SQL compares this
 // preflight fingerprint again in the saving transaction, closing a source-change race.
 const preflight = action === 'save' ? await invoke('template') : null;
 const value = await invoke(action, preflight?.fingerprint ?? null);
 const result = action === 'template' ? decodeRewardSetup(value.result) : action === 'list'
  ? (() => { if (!Array.isArray(value.result) || value.result.length > 100) throw Error('hosted_copy_unavailable'); return value.result.map(r => decodeSavedRewardSetup(r, 10143)); })()
  : decodeSavedRewardSetup(value.result, 10143, id!);
 return { result, source: value.source };
}
