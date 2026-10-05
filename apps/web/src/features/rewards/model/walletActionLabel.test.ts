import {expect,it} from 'vitest';
import {walletActionLabel} from './walletActionLabel';

it('marks only the embedded runtime ID namespace as Privy',()=>{
  expect(walletActionLabel('Sign consent',{id:`privy:0x${'ab'.repeat(20)}`})).toBe('Sign consent · Privy');
  expect(walletActionLabel('Sign consent',{id:'external-wallet'})).toBe('Sign consent');
  expect(walletActionLabel('Sign consent',null)).toBe('Sign consent');
  expect(walletActionLabel('Sign consent',{id:'Privy'})).toBe('Sign consent');
});
