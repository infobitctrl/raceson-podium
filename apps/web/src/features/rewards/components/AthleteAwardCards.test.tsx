import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import AthleteAwardCards,{AthleteAwardReview} from './AthleteAwardCards';
import RewardAccountSummary from './RewardAccountSummary';
vi.mock('@/shared/i18n/I18nContext',()=>({useI18n:()=>({locale:'en',t:(v:string)=>v})}));
vi.mock('./AthleteProfileWallet',()=>({default:()=> <p>Explicit wallet setup</p>}));
const id='73000000-0000-4000-8000-000000000010';
const award={approvalId:id,athleteProfileId:id,entitlementId:'0x'+'a'.repeat(64),slot:1,amountWei:'1000000000000000000',claims:[]};
it('keeps a walletless award visible and opening review creates no request or consent',()=>{
 const review=vi.fn(),claim=vi.fn();render(<AthleteAwardCards awards={[award]} destinations={[]} chainId={10143} hr={false} busy={false} failed={false} onReview={review} onClaim={claim} onRefresh={()=>{}}/>);
 expect(screen.getByText('Wallet needed')).toBeVisible();expect(screen.getByText(/stays reserved/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Review reward'}));expect(review).toHaveBeenCalledWith(award);expect(claim).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'View receipt'})).not.toBeInTheDocument();
});
it('approved signatures do not become a paid card or claim-history entry',()=>{
 render(<AthleteAwardCards awards={[{...award,claims:[{id,prepared:true,consented:true,approved:true,paid:false}]}]} destinations={[]} chainId={10143} hr={false} busy={false} failed={false} onReview={()=>{}} onClaim={()=>{}} onRefresh={()=>{}}/>);
 expect(screen.getByText('Processing')).toBeVisible();expect(screen.queryByRole('table')).not.toBeInTheDocument();expect(screen.queryByText('Claimed')).not.toBeInTheDocument();
});
it('request preview never submits to an incomplete or failed destination list',()=>{
 const request=vi.fn(),props={award,hr:false,chainId:10143,destinations:[{requestId:id,athleteProfileId:id,address:'0x'+'b'.repeat(40),chainId:10143 as const,status:'pending_review' as const,requestedAt:'2026-10-06T00:00:00Z',withdrawnAt:null}],complete:false,busy:false,failed:false,refresh:async()=>{},onRecover:()=>{},onRequest:request};
 const v=render(<AthleteAwardReview {...props}/>);const button=screen.getByRole('button',{name:'Request reward to this wallet'});expect(button).toBeDisabled();fireEvent.click(button);expect(request).not.toHaveBeenCalled();
 v.rerender(<AthleteAwardReview {...props} complete failed/>);expect(button).toBeDisabled();
 v.rerender(<AthleteAwardReview {...props} complete/>);fireEvent.click(button);expect(request).toHaveBeenCalledExactlyOnceWith(id);
});
it('four totals retain exact integer categories and stay unknown until pagination finishes',()=>{
 const props={awards:[{chainId:10143 as const,entitlementId:award.entitlementId,amountWei:'1000000000000000000'}],confirmedPaid:0n,paymentsComplete:true,claimReadiness:{reviewable:0n,waiting:1000000000000000000n},complete:false,loading:false,hasMore:true,onMore:()=>{}};
 const v=render(<RewardAccountSummary {...props}/>);expect(screen.getByText('Rewards earned')).toBeVisible();expect(screen.getAllByText('—',{exact:false})).toHaveLength(4);
 v.rerender(<RewardAccountSummary {...props} complete hasMore={false}/>);expect(screen.queryByText('—',{exact:false})).not.toBeInTheDocument();expect(screen.getByText('Awaiting steps')).toBeVisible();
});
