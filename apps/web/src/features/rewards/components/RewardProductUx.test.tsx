import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/shared/i18n/I18nProvider';
import { createRewardAllocationRehearsalV3 } from '@raceson/domain/rewards/allocation-rehearsal-v3';
import { previewRewardAllocationV3 } from '@raceson/domain/rewards/allocation-preview-v3';
import { consentV3Fixture } from '../model/athleteConsentV3Fixtures.test-helper';
import { roundedRewardAmount } from '../model/rewardDisplayAmount';
import { allocationPotNode, type DistributionNode } from '../model/allocationTree';
import RewardAwardActivity from './RewardAwardActivity';
import RewardWalletPanel from './RewardWalletPanel';
const calls = vi.hoisted(() => ({ payment: vi.fn() }));
vi.mock('../data/athletePaymentStatusV3', () => ({ getAthletePaymentStatusV3: (...args: unknown[]) => calls.payment(...args) }));
const f = consentV3Fixture();
beforeEach(() => calls.payment.mockReset().mockResolvedValue(f.payment));
it('rounds only display values using integers, including one wei and a carry', () => {
  expect(roundedRewardAmount('1','en')).toEqual({ approximate:true,text:'< 0.0001' });
  expect(roundedRewardAmount('1999999999999999999','hr')).toEqual({ approximate:true,text:'2' });
  expect(roundedRewardAmount('1868346153846153846','en')).toEqual({ approximate:true,text:'1.8683' });
  expect(roundedRewardAmount('400100000000000000','en')).toEqual({ approximate:false,text:'0.4001' });
});
it.each(['four_rounds','five_rounds','distance_hold'] as const)('conserves every tree branch for %s, including holds and participation', scenario => {
  const fixture=createRewardAllocationRehearsalV3(scenario,'compact_20'), preview=previewRewardAllocationV3(fixture.rules,fixture.mapping,fixture.source);
  const names={family:(id:string)=>id,category:(id:string)=>id,beneficiary:(id:string)=>id,remaining:'Retained'};
  const check=(node:DistributionNode)=>{ if(node.children){expect(node.children.reduce((sum,c)=>sum+c.wei,0n)).toBe(node.wei);node.children.forEach(check)} };
  [...preview.rounds,preview.league].forEach((pot,i)=>check(allocationPotNode(pot,String(i),String(i),names)));
});
it('shows a confirmed receipt once per award and disables all historical consent attempts', async () => {
  calls.payment.mockResolvedValueOnce({...f.payment,confirmed:true,state:'confirmed',transactionHash:`0x${'a'.repeat(64)}`,blockNumber:'400',blockHash:`0x${'b'.repeat(64)}`}).mockResolvedValueOnce(f.payment);
  const old={...f.claim,claimId:'8fe00000-0000-4000-8000-000000000020'};
  render(<I18nProvider initialLocale="en"><RewardAwardActivity award={f.award} claims={[f.claim,old]} complete onRefresh={vi.fn()} onAccessLost={vi.fn()}/></I18nProvider>);
  await screen.findByText('Paid', {exact:true});
  if (!screen.getByText('Claim history (2)').closest("details")!.open) fireEvent.click(screen.getByText('Claim history (2)'));
  expect(screen.queryByRole("button",{name:"Claim reward"})).not.toBeInTheDocument();
  expect(screen.queryByText(/1\.000000000000000001/)).not.toBeInTheDocument();
});
it('a failed receipt read stays unknown and an explicit retry recovers without signing', async () => {
  calls.payment.mockRejectedValueOnce({status:503});
  render(<I18nProvider initialLocale="en"><RewardAwardActivity award={f.award} claims={[f.claim]} complete onRefresh={vi.fn()} onAccessLost={vi.fn()}/></I18nProvider>);
  await screen.findByText('Payment status unavailable');if (!screen.getByText('Claim history (1)').closest("details")!.open) fireEvent.click(screen.getByText('Claim history (1)'));
  expect(screen.queryByRole("button", { name: "Claim reward" })).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Retry status check'}));
  await screen.findByText('Not sent');expect(screen.getByRole('button',{name:'Claim reward'})).toBeEnabled();expect(calls.payment).toHaveBeenCalledTimes(2);
});
it('incomplete claim pagination cannot offer signing even with an unpaid first page',async()=>{
  render(<I18nProvider initialLocale="en"><RewardAwardActivity award={f.award} claims={[f.claim]} complete={false} onRefresh={vi.fn()} onAccessLost={vi.fn()}/></I18nProvider>);
  await waitFor(()=>expect(calls.payment).toHaveBeenCalled());if (!screen.getByText('Claim history (1)').closest("details")!.open) fireEvent.click(screen.getByText('Claim history (1)'));
  expect(screen.queryByRole("button", { name: "Claim reward" })).not.toBeInTheDocument();
});
it('reuses only the selected profile destination and never labels pending review as payout approval',async()=>{
  const destination={requestId:f.claim.destinationId,athleteProfileId:f.award.athleteProfileId,address:f.claim.recipientAddress,chainId:31337 as const,requestedAt:'2026-09-14T10:00:00Z',withdrawnAt:null,status:'pending_review' as const};
  render(<I18nProvider initialLocale="en"><RewardWalletPanel athleteProfileId={f.award.athleteProfileId} destinations={[destination]}/></I18nProvider>);
  expect(screen.getByText('Existing wallet destination')).toBeVisible();expect(screen.getByText(f.claim.recipientAddress)).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();await waitFor(()=>expect(screen.queryByRole('button',{name:'Browser wallet'})).not.toBeInTheDocument());
});
