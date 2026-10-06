import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import ControllerSettlement from './ControllerSettlement';
import {decodeControllerSettlement} from '../data/controllerSettlement';
import {sponsorSettlementDataV4} from '@raceson/rewards-chain';
import type {ControllerConnection} from './RewardsControl';
const mocks=vi.hoisted(()=>({confirm:vi.fn(),recover:vi.fn()}));
vi.mock('../data/controllerTransactions',async original=>({...await original<object>(),confirmControllerJob:mocks.confirm,recoverControllerJob:mocks.recover}));
const id=(n:number)=>`73000000-0000-4000-8000-${String(n).padStart(12,'0')}`,address=(n:number)=>'0x'+String(n).repeat(40),hash=(n:number)=>'0x'+String(n).repeat(64),wallet=address(2);
function fixture(){let current=true;const view={schema:'podium-sponsor-settlement-view-v1',setupId:id(1),slot:0,sourceHash:'a'.repeat(64),operator:wallet,
 pot:{slot:0,address:address(6),amountWei:'100',state:4,paused:false,allocatedWei:'40',paidWei:'10',returnedWei:'0',remainingWei:'90',claimDeadline:'1800000000',entitlementCount:'2'},
 lanes:{unallocated:{recipient:address(3),originalWei:'60',returnedWei:'0',remainingWei:'60'},expired:{recipient:address(1),originalWei:'30',returnedWei:'0',remainingWei:'30'}},
 available:[{action:'returnUnallocated',recipient:address(3),amountWei:'60'},{action:'returnExpired',recipient:address(1),amountWei:'30'}],observedBlock:{number:'100',hash:hash(7),timestamp:'1800000000'},receipts:[]};
 const job={id:id(4),context:{kind:'settlement',setupId:id(1),slot:0,action:'returnExpired',recipient:address(1),amountWei:'30',source:'original immutable source'},transaction:{chainId:10143,to:address(6),value:'0',data:sponsorSettlementDataV4('returnExpired'),nonce:'0',gas:'120000',gasPrice:'1'},hash:null,confirmed:false,factory:null};let pending:unknown=null;
 const connection:ControllerConnection={subject:'did:privy:fixture',wallets:[wallet],isCurrent:()=>current,getWallet:vi.fn(),signTransaction:vi.fn(),request:vi.fn(async(path,body)=>{if(path==='/transactions'){if(body)return structuredClone(job);return{pending,factory:null};}return structuredClone(view);})};
 return{view,job,connection,retire:()=>{current=false;},pending:(value:unknown)=>{pending=value;}};}
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();});
it('shows paid and separate original lanes without requesting a wallet or mutation',async()=>{
 const f=fixture();render(<ControllerSettlement connection={f.connection} wallet={wallet} setupId={id(1)} slot={0}/>);
 expect(await screen.findByText('Paid awards')).toBeVisible();expect(screen.getByText(`Original destination: ${address(1)}`)).toBeVisible();expect(screen.getByText(`Original destination: ${address(3)}`)).toBeVisible();
 expect(f.connection.getWallet).not.toHaveBeenCalled();expect(f.connection.signTransaction).not.toHaveBeenCalled();expect(vi.mocked(f.connection.request).mock.calls.every(([,body])=>body===undefined)).toBe(true);
});
it('prepares original return, shows exact gas/prize amounts and requires separate acknowledgement before Privy',async()=>{
 const f=fixture();mocks.confirm.mockResolvedValue({...f.job,hash:hash(8)});render(<ControllerSettlement connection={f.connection} wallet={wallet} setupId={id(1)} slot={0}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review · Return expired awards'}));const confirm=await screen.findByRole('button',{name:'Confirm settlement · Privy'});expect(confirm).toBeDisabled();expect(mocks.confirm).not.toHaveBeenCalled();
 expect(screen.getByText('Prize amount: 0.00000000000000003 test MON')).toBeVisible();expect(screen.getByText(/Maximum gas fee: 0.00000000000012 test MON/)).toBeVisible();
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(confirm);await waitFor(()=>expect(mocks.confirm).toHaveBeenCalledTimes(1));expect(await screen.findByRole('button',{name:'Verify saved settlement'})).toBeVisible();
 expect(f.connection.request).toHaveBeenCalledWith('/transactions',{action:'prepare',kind:'settlement',setupId:id(1),slot:0,operation:'returnExpired',expectedSourceHash:'a'.repeat(64)});
});
it('refresh/reload recovers a saved journal without another signature',async()=>{
 const f=fixture(),pending={...f.job,hash:hash(8)};f.pending(pending);mocks.recover.mockResolvedValue(pending);
 render(<ControllerSettlement connection={f.connection} wallet={wallet} setupId={id(1)} slot={0}/>);fireEvent.click(await screen.findByRole('button',{name:'Verify saved settlement'}));await waitFor(()=>expect(mocks.recover).toHaveBeenCalledWith(f.connection,pending));expect(mocks.confirm).not.toHaveBeenCalled();expect(f.connection.signTransaction).not.toHaveBeenCalled();
});
it('changed prepared destination cannot reach Privy',async()=>{
 const f=fixture();f.job.context.recipient=address(9);render(<ControllerSettlement connection={f.connection} wallet={wallet} setupId={id(1)} slot={0}/>);fireEvent.click(await screen.findByRole('button',{name:'Review · Return expired awards'}));expect(await screen.findByRole('alert')).toBeVisible();expect(mocks.confirm).not.toHaveBeenCalled();expect(f.connection.signTransaction).not.toHaveBeenCalled();
});
it('manual receipt recovery sends only action/request/hash and never client amounts or destinations',async()=>{
 const f=fixture();render(<ControllerSettlement connection={f.connection} wallet={wallet} setupId={id(1)} slot={0}/>);await screen.findByText('Paid awards');fireEvent.click(screen.getByText('Recover an existing settlement hash'));fireEvent.change(screen.getByLabelText('Settlement transaction hash'),{target:{value:hash(8)}});fireEvent.change(screen.getByLabelText('Settlement operation'),{target:{value:'returnExpired'}});fireEvent.click(screen.getByRole('button',{name:'Verify existing settlement'}));await waitFor(()=>expect(f.connection.request).toHaveBeenCalledWith(`/campaigns/${id(1)}/settlement/0`,{action:'receipt',requestId:expect.any(String),operation:'returnExpired',transactionHash:hash(8)}));expect(mocks.confirm).not.toHaveBeenCalled();
});
it('rejects a wrong escrow scope or balance that would include paid awards in returns',()=>{
 const f=fixture();expect(()=>decodeControllerSettlement(f.view,id(9),0,wallet)).toThrow();f.view.lanes.expired.remainingWei='40';expect(()=>decodeControllerSettlement(f.view,id(1),0,wallet)).toThrow();
});

it('a retired account cannot confirm a prepared settlement',async()=>{
 const f=fixture();render(<ControllerSettlement connection={f.connection} wallet={wallet} setupId={id(1)} slot={0}/>);fireEvent.click(await screen.findByRole('button',{name:'Review · Return expired awards'}));await screen.findByRole('button',{name:'Confirm settlement · Privy'});fireEvent.click(screen.getByRole('checkbox'));f.retire();fireEvent.click(screen.getByRole('button',{name:'Confirm settlement · Privy'}));expect(mocks.confirm).not.toHaveBeenCalled();
});
