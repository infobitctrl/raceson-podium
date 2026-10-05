import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import type {ReactElement} from "react";
import {render as rtlRender,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import type {PublicDirectory} from '@raceson/domain/rewards/public-directory';
import {I18nProvider} from '@/shared/i18n/I18nProvider';
import PodiumHome from './PodiumHome';
vi.mock('@/lib/auth',()=>({useAuth:()=>({user:null,session:null})}));
vi.mock('../data/campaignBranding',()=>({readCampaignBranding:async()=>[]}));
const query=vi.hoisted(()=>vi.fn());
vi.mock('../data/publicDirectory',()=>({usePublicDirectory:query}));
vi.mock('../components/PodiumPaymentRing',()=>({default:({paid,held,returned}:{paid:bigint;held:bigint;returned:bigint})=><output aria-label="Payout balance">{`${paid}/${held}/${returned}`}</output>}));
const unit=1000000000000000000n;
function directory(paid=0n,held=unit,returned=0n):PublicDirectory{
 return {chainId:10143,sponsors:1,checkedAt:'2026-09-29T02:03:29Z',refreshStatus:'current',items:[{selection:null,publishedAt:'2026-09-28T12:00:00Z',verified:true,campaign:{id:'73000000-0000-4000-8000-000000000001',name:'Synthetic funded race',chainId:10143,budgetWei:unit.toString(),address:`0x${'11'.repeat(20)}`,fundingHash:`0x${'aa'.repeat(32)}`,blockNumber:'100',blockTimestamp:'1800000000',pots:[{slot:0,name:'Race',amountWei:unit.toString(),state:3,paused:false,allocatedWei:unit.toString(),paidWei:paid.toString(),remainingWei:held.toString(),returnedWei:returned.toString(),claimDeadline:'1800001000',groups:[{name:'Official category',amountWei:unit.toString()}]}]}}]};
}
function view(data:PublicDirectory,locale:'en'|'hr'='en'){
 query.mockReturnValue({data,isPending:false,isError:false,isFetching:false,refetch:vi.fn()});
 return render(<I18nProvider initialLocale={locale}><MemoryRouter><PodiumHome/></MemoryRouter></I18nProvider>);
}
beforeEach(()=>query.mockReset());
it('distinguishes funded prizes from a history with no recipient payouts',()=>{
 view(directory());
 expect(screen.getByRole('heading',{name:'No payouts yet'})).toBeVisible();
 expect(screen.getByText('No recipient payments are confirmed in the published campaigns yet.')).toBeVisible();
 expect(screen.queryByText('No confirmed funds yet.')).not.toBeInTheDocument();
 expect(screen.queryByLabelText('Payout balance')).not.toBeInTheDocument();
 expect(screen.getByText('Funded pots')).toBeVisible();
});
it('does not treat a return as a recipient payout',()=>{
 view(directory(0n,0n,unit));
 expect(screen.getByRole('heading',{name:'No payouts yet'})).toBeVisible();
 expect(screen.queryByLabelText('Payout balance')).not.toBeInTheDocument();
});
it('charts only verified campaigns with payouts, preserving exact integer balances',()=>{
 const data=directory(unit/4n,unit/2n,unit/4n);
 data.items.push({...directory().items[0],campaign:{...directory().items[0].campaign,id:'73000000-0000-4000-8000-000000000002'}});
 view(data);
 expect(screen.getByLabelText('Payout balance')).toHaveTextContent('250000000000000000/500000000000000000/250000000000000000');
 expect(screen.queryByText(/after the first confirmed recipient payout/)).not.toBeInTheDocument();
});
it('withholds aggregate payment totals when a campaign is unverified',()=>{
 const data=directory();data.items[0].verified=false;view(data);
 expect(screen.getByRole('heading',{name:'Payout history could not be verified'})).toBeVisible();
 expect(screen.queryByLabelText('Payout balance')).not.toBeInTheDocument();
 expect(screen.queryByText(/after the first confirmed recipient payout/)).not.toBeInTheDocument();
});
it('explains the empty payout breakdown in Croatian',()=>{
 view(directory(),'hr');
 expect(screen.getByRole('heading',{name:'Još nema isplata'})).toBeVisible();
});

function render(ui:ReactElement){return rtlRender(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{ui}</QueryClientProvider>);}
