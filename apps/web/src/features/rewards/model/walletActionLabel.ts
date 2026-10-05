import type {DetectedRewardWallet} from '../data/browserWallet';

/** The embedded runtime owns this ID namespace; extension display names do not. */
export function isPrivyRewardWallet(wallet: Pick<DetectedRewardWallet, 'id'> | null | undefined) {
  return /^privy:0x[0-9a-f]{40}$/.test(wallet?.id ?? '');
}

export function walletActionLabel(label: string, wallet: Pick<DetectedRewardWallet, 'id'> | null | undefined) {
  return isPrivyRewardWallet(wallet) ? `${label} · Privy` : label;
}
