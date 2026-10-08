import {directClaimError} from './directClaimError';
import {describe,it,expect} from 'vitest';
describe('claim failure recovery',()=>{
 it.each([
  [{code:'reward_direct_claim_unavailable'},'checking','checking'],
  [Error('unavailable'),'receipt','receipt'],
  [{cause:{code:4001}},'sending','cancelled'],
  [Error('wallet_changed'),'wallet','wallet'],
  [Error('reward_wallet_challenge_expired'),'preparing','expired'],
  [Error('claim_sponsorship_unavailable'),'sending','sponsorship'],
  [Error('App secret is required for gas sponsored transactions.'),'sending','sponsorship'],
  [Error('insufficient funds for gas'),'sending','sponsorship'],
  [Error('paymaster rejected'),'sending','sponsorship'],
  [Error('unknown'),'preparing','preparing'],
  [Error('unknown'),'sending','unknown'],
 ] as const)('classifies %o in %s as %s',(error,phase,expected)=>expect(directClaimError(error,phase)).toBe(expected));
 it('bounds cyclic provider causes',()=>{const error:{cause?:unknown}={};error.cause=error;expect(directClaimError(error,'sending')).toBe('unknown');});
});
