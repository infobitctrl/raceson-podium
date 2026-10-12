import type {PublicRewardPage} from '@raceson/domain/rewards/public-campaign';

/** Wallet fields are an opt-in representation. Already-open clients validate
 * exact row keys, so adding even an optional field can hide their whole ledger.
 * Project only after the normal complete, finalized award verification. */
export function publicAwardResponse(page: PublicRewardPage, accept?: string): PublicRewardPage {
  if (accept?.split(',').some(type => type.trim().toLowerCase() === 'application/vnd.raceson.reward-wallets.v1+json')) return page;
  return {...page, rows: page.rows.map(row => {
    const compatible = {...row};
    delete compatible.recipientAddress;
    delete compatible.registeredAddress;
    return compatible;
  })};
}
