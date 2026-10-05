import type { FiveRoundCopyPinV1 } from './five-round-copy-v1.js';
import type { FiveRoundCombinedSelection } from '@raceson/domain/rewards/five-round-copy-v1';
import { hostedCopyUnaffiliatedDecision } from './hosted-copy-unaffiliated-review.js';

// Owner's explicit 5 October 2026 instruction: Long result and Races Club29.
// Scope is combined club/participation only; this never rewrites either result,
// approves a classification, attests a wallet or makes an allocation payable.
export const hostedCopyCombinedReview = Object.freeze({
 version:'owner-combined-selection-20261005-v1',
 projectionSha256:'7043cf919edd4dc3bdf40d022c60d0fc40036f2e4093b33b57dfc040bda3975d',
 note:'Round 3 review: Races Mon163 counts once for combined club and participation rewards, using the Long result (2:30:18.052) and Races Club29. Both published results and the existing classification tables are preserved.',
});
export function hostedCopySelections(pin: FiveRoundCopyPinV1): FiveRoundCombinedSelection[] {
 if (pin.projectionSha256 !== hostedCopyCombinedReview.projectionSha256) return [];
 return [{slot:3,athleteId:'1722bcb5-f7f2-4772-97eb-631fe13879e5',
  resultIds:['178b7d23-1086-4e3f-b604-bdecb32b5f18','5bbb2d72-7b65-4391-aef3-1b6d5b5ce564'],
  keepResultId:'178b7d23-1086-4e3f-b604-bdecb32b5f18'}];
}
export function hostedCopyUnaffiliatedReview(pin:FiveRoundCopyPinV1) {
 return pin.projectionSha256===hostedCopyUnaffiliatedDecision.sourceHash ? hostedCopyUnaffiliatedDecision : undefined;
}
export function hostedCopyReviewNote(pin:FiveRoundCopyPinV1) {
 return [hostedCopySelections(pin).length?hostedCopyCombinedReview.note:null,hostedCopyUnaffiliatedReview(pin)?.note].filter(Boolean).join(' ');
}

export const hostedCopySourcePin: FiveRoundCopyPinV1 = Object.freeze({
 batchSha256:'073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644',
 projectionSha256:'7043cf919edd4dc3bdf40d022c60d0fc40036f2e4093b33b57dfc040bda3975d',
 leagueId:'ba81ced7-b2c5-4d51-95b6-d95d8c04fa36',seasonId:'323d55fc-a396-4ff4-a17e-eb7152c8f8f1',
});
