import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import type {SponsorClaim} from '../data/sponsorProgramme';
import RewardClaimProgress from './RewardClaimProgress';
const claim:Pick<SponsorClaim,'status'|'current'|'receipt'>={status:'ready_to_pay',current:true,receipt:null};
it('a submitted hash never marks payment complete',()=>{
 const {container}=render(<RewardClaimProgress view={claim} pending={'0x'+'a'.repeat(64)} hr={false}/>);
 expect(screen.getByText('Transaction submitted. Receipt verification is still required.')).toBeVisible();
 expect(container.querySelectorAll('[data-state="complete"]')).toHaveLength(4);
 expect(container.querySelector('[aria-current="step"]')).toHaveTextContent('Verified payment');
});
it('held or stale claims do not inherit completed readiness',()=>{
 const {container,rerender}=render(<RewardClaimProgress view={{...claim,status:'held'}} pending={null} hr={false}/>);
 expect(container.querySelectorAll('[data-state="complete"]')).toHaveLength(0);
 rerender(<RewardClaimProgress view={{...claim,current:false}} pending={null} hr={false}/>);
 expect(container.querySelectorAll('[data-state="complete"]')).toHaveLength(0);
});
it('requires the paid status and receipt for final completion',()=>{
 const {container,rerender}=render(<RewardClaimProgress view={{...claim,status:'paid'}} pending={null} hr={false}/>);
 expect(container.querySelectorAll('[data-state="complete"]')).toHaveLength(4);
 rerender(<RewardClaimProgress view={{...claim,status:'paid',receipt:{transactionHash:'0x1',amountWei:'1',recipient:'0x1',blockNumber:'1',blockHash:'0x2'}}} pending={null} hr={false} club/>);
 expect(container.querySelectorAll('[data-state="complete"]')).toHaveLength(4);
 expect(screen.getByText('Two owner signatures')).toBeVisible();
});

it('shows identity and wallet control separately without marking unchecked consent complete',()=>{
 const {container}=render(<RewardClaimProgress view={{...claim,status:'awaiting_consent'}} pending={null} hr={false}/>);
 expect(screen.getByText('Sporting identity reviewed')).toBeVisible();
 expect(screen.getByText('Wallet control verified')).toBeVisible();
 expect(container.querySelectorAll('[data-state="complete"]')).toHaveLength(2);
 expect(container.querySelector('[aria-current="step"]')).toHaveTextContent('Your consent');
});
