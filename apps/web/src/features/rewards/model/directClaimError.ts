export type DirectClaimPhase = 'checking' | 'wallet' | 'preparing' | 'sending' | 'receipt';
export type DirectClaimError = 'checking' | 'wallet' | 'cancelled' | 'expired' | 'preparing' | 'sponsorship' | 'receipt' | 'unknown';

/** Match provider codes without displaying raw provider payloads or signatures. */
export function directClaimError(error: unknown, phase: DirectClaimPhase): DirectClaimError {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  for (let current = error; current && typeof current === 'object' && !seen.has(current) && seen.size < 4;) {
    seen.add(current);
    const value = current as {code?: unknown; message?: unknown; cause?: unknown};
    if (typeof value.code === 'string' || typeof value.code === 'number') parts.push(String(value.code));
    if (typeof value.message === 'string') parts.push(value.message.slice(0, 2000));
    current = value.cause;
  }
  const reason = parts.join(' ').toLowerCase();
  // A failed read cannot mean that a wallet transaction was submitted.
  if (phase === 'checking' || phase === 'receipt') return phase;
  if (/\b4001\b|user[_ ]rejected|user[_ ]denied|request[_ ]cancelled|user[_ ]cancelled/.test(reason)) return 'cancelled';
  if (/wallet_changed|wrong_network|wallet_disconnected/.test(reason)) return 'wallet';
  if (/challenge_expired/.test(reason)) return 'expired';
  if (/claim_sponsorship_unavailable|paymaster|gas sponsor|sponsor(?:ship|ed).*unavailable|insufficient funds|insufficient.*gas/.test(reason)) return 'sponsorship';
  return phase === 'sending' ? 'unknown' : phase;
}

export const directClaimErrorCopy: Record<DirectClaimError, {title: [string, string]; body: [string, string]}> = {
  checking: {title: ['Reward check unavailable', 'Provjera nagrade nije dostupna'], body: ['We could not load this reward. Refresh its status to continue to wallet setup. No claim was submitted.', 'Nije moguće učitati nagradu. Osvježite stanje za nastavak postavljanja novčanika. Preuzimanje nije poslano.']},
  wallet: {title: ['Connect your reward wallet', 'Povežite novčanik za nagrade'], body: ['Connect your wallet on Monad Testnet and confirm ownership to continue. No claim was submitted.', 'Povežite novčanik na Monad Testnetu i potvrdite vlasništvo za nastavak. Preuzimanje nije poslano.']},
  cancelled: {title: ['Wallet confirmation cancelled', 'Potvrda novčanika je otkazana'], body: ['Your reward is still available. When ready, confirm the destination and try again.', 'Nagrada je i dalje dostupna. Kada ste spremni, potvrdite odredište i pokušajte ponovno.']},
  expired: {title: ['Wallet verification expired', 'Provjera novčanika je istekla'], body: ['Confirm the destination and try again to renew your wallet verification. No claim was submitted.', 'Potvrdite odredište i pokušajte ponovno za novu provjeru novčanika. Preuzimanje nije poslano.']},
  preparing: {title: ['Claim preparation unavailable', 'Priprema preuzimanja nije dostupna'], body: ['Refresh the reward status, then try again. No claim was submitted.', 'Osvježite stanje nagrade pa pokušajte ponovno. Preuzimanje nije poslano.']},
  sponsorship: {title: ['RacesOn fee sponsorship unavailable', 'RacesOn plaćanje naknade nije dostupno'], body: ['RacesOn could not cover the network fee. Try again later. You do not need to add test MON.', 'RacesOn nije mogao pokriti mrežnu naknadu. Pokušajte kasnije. Ne trebate dodavati test MON.']},
  receipt: {title: ['Payment check unavailable', 'Provjera isplate nije dostupna'], body: ['Your transaction is saved. Use Check payment again; do not submit another claim.', 'Vaša transakcija je spremljena. Ponovno odaberite Provjeri isplatu; nemojte slati novo preuzimanje.']},
  unknown: {title: ['Payment status needs checking', 'Potrebna je provjera stanja isplate'], body: ['The wallet did not return a transaction confirmation. Refresh status to check whether the reward was paid before trying again.', 'Novčanik nije vratio potvrdu transakcije. Osvježite stanje da provjerite je li nagrada isplaćena prije novog pokušaja.']},
};
