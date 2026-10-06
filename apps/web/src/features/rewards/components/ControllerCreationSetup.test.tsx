import {I18nProvider} from "@/shared/i18n/I18nProvider";
import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import ControllerCreationSetup from './ControllerCreationSetup';
import type {ControllerConnection} from '../screens/RewardsControl';
import type {ControllerSession} from '../data/controller';
const calls=vi.hoisted(()=>({recover:vi.fn(),confirm:vi.fn()}));
vi.mock('../data/controllerTransactions',async original=>({...await original<object>(),recoverControllerJob:calls.recover,confirmControllerJob:calls.confirm}));
const id='73000000-0000-4000-8000-000000000001',wallet='0x'+'22'.repeat(20);
const pending={id,context:{kind:'distribution',setupId:id,approvalId:'73000000-0000-4000-8000-000000000002',action:'upload',start:0,end:1,source:'synthetic'},transaction:{chainId:10143,to:'0x'+'44'.repeat(20),data:'0xaa',value:'0',nonce:'10',gas:'200000',gasPrice:'100000000000'},hash:null,confirmed:false,factory:null};
const session:ControllerSession={subject:'did:privy:synthetic',wallet,chainId:10143,creation:{configured:true,address:wallet,balanceWei:'1000000000000000000'}};
function connection(hash:string|null=null):ControllerConnection{return {subject:session.subject,wallets:[wallet],isCurrent:()=>true,getWallet:vi.fn(),signTransaction:vi.fn(),request:vi.fn(async()=>({pending:{...pending,hash},factory:null}))};}
beforeEach(()=>vi.clearAllMocks());
it('directs an unsigned distribution to exact campaign review without signing or resuming',async()=>{
 const c=connection();render(<ControllerCreationSetup connection={c} session={session} onRefresh={vi.fn()}/>);
 expect(await screen.findByRole('link',{name:'Review pending distribution'})).toHaveAttribute('href',`/rewards/control?campaign=${id}&wallet=${wallet}`);
 expect(screen.getByText('Campaign creation is waiting for this controller request.')).toBeVisible();
 expect(screen.queryByText('Ready · deployment-only controller access verified')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Recover a saved signature'})).toBeVisible();
 expect(calls.confirm).not.toHaveBeenCalled();expect(calls.recover).not.toHaveBeenCalled();expect(c.signTransaction).not.toHaveBeenCalled();
});
it('retains explicit saved-signature recovery without a new signing operation',async()=>{
 const c=connection();render(<ControllerCreationSetup connection={c} session={session} onRefresh={vi.fn()}/>);
 const recover=await screen.findByRole('button',{name:'Recover a saved signature'});await act(async()=>fireEvent.click(recover));
 expect(calls.recover).toHaveBeenCalledWith(c,pending);expect(calls.confirm).not.toHaveBeenCalled();expect(c.signTransaction).not.toHaveBeenCalled();
});
it('uses receipt recovery for a submitted request and hides unsigned review guidance',async()=>{
 const hash='0x'+'ab'.repeat(32),c=connection(hash);render(<ControllerCreationSetup connection={c} session={session} onRefresh={vi.fn()}/>);
 const verify=await screen.findByRole('button',{name:'Verify saved transaction'});await act(async()=>fireEvent.click(verify));
 expect(calls.recover).toHaveBeenCalledWith(c,{...pending,hash});expect(screen.queryByRole('link',{name:'Review pending distribution'})).not.toBeInTheDocument();expect(calls.confirm).not.toHaveBeenCalled();
});

it('shows exact request details and treats consumed nonce as evidence, never payment or cancellation',async()=>{
 const c=connection();c.request=vi.fn(async()=>({pending,factory:null,nonceStatus:{state:'consumed',finalizedNonce:'11',pendingNonce:'11',observedAt:'2026-09-29T07:00:00.000Z'}}));
 render(<ControllerCreationSetup connection={c} session={session} onRefresh={vi.fn()}/>);
 expect(await screen.findByText(/This does not confirm this distribution/)).toBeVisible();
 fireEvent.click(screen.getByText('Request and network details'));
 expect(screen.getByText('Reserved nonce')).toBeVisible();expect(screen.getByText('10')).toBeVisible();expect(screen.getByText(pending.transaction.to)).toBeVisible();
 expect(screen.getByText(/reservation stays in place/)).toBeVisible();expect(screen.queryByRole('button',{name:/cancel/i})).not.toBeInTheDocument();
 expect(calls.confirm).not.toHaveBeenCalled();expect(calls.recover).not.toHaveBeenCalled();
});
it('missing signature gives an actionable error while preserving exact campaign review',async()=>{
 calls.recover.mockRejectedValueOnce(Error('controller_local_signature_missing'));const c=connection();
 render(<ControllerCreationSetup connection={c} session={session} onRefresh={vi.fn()}/>);
 const recover=await screen.findByRole('button',{name:'Recover a saved signature'});await act(async()=>fireEvent.click(recover));
 expect(screen.getByRole('alert')).toHaveTextContent('No signature is saved in this browser');expect(screen.getByRole('alert')).toHaveTextContent('request remains reserved');
 expect(screen.getByRole('link',{name:'Review pending distribution'})).toHaveAttribute('href',`/rewards/control?campaign=${id}&wallet=${wallet}`);expect(calls.confirm).not.toHaveBeenCalled();
});
it('refresh can recover unavailable observations without signing or releasing the request',async()=>{
 const c=connection(),refresh=vi.fn();render(<ControllerCreationSetup connection={c} session={session} onRefresh={refresh}/>);
 expect(await screen.findByText(/Chain status is unavailable/)).toBeVisible();
 c.request=vi.fn(async()=>({pending,factory:null,nonceStatus:{state:'unused',finalizedNonce:'10',pendingNonce:'10',observedAt:'2026-09-29T07:00:00.000Z'}}));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Check setup status'})));
 expect(screen.getByText(/signature may still be saved in another browser/)).toBeVisible();expect(refresh).toHaveBeenCalledTimes(1);expect(calls.confirm).not.toHaveBeenCalled();
});

it('keeps a distribution reservation from blocking a separate deployment wallet',async()=>{
 const c=connection();render(<ControllerCreationSetup connection={c} session={{...session,creation:{configured:true,address:'0x'+'55'.repeat(20),balanceWei:'0'}}} onRefresh={vi.fn()}/>);
 expect(await screen.findByText('Provider access verified · separate deployment wallet')).toBeVisible();
 expect(await screen.findByText(/The distribution request remains reserved/)).toBeVisible();
 expect(screen.queryByText(/Campaign creation is waiting/)).not.toBeInTheDocument();
 expect(calls.confirm).not.toHaveBeenCalled();
});

it('Croatian consumed-nonce recovery keeps exact review and never signs automatically',async()=>{
 const c=connection();c.request=vi.fn(async()=>({pending,factory:null,nonceStatus:{state:'consumed',finalizedNonce:'11',pendingNonce:'11',observedAt:'2026-09-29T07:00:00.000Z'}}));
 render(<I18nProvider initialLocale="hr"><ControllerCreationSetup connection={c} session={session} onRefresh={vi.fn()}/></I18nProvider>);
 expect(await screen.findByText(/To ne potvrđuje ovu raspodjelu/)).toBeVisible();
 expect(screen.getByRole('link',{name:'Pregledaj raspodjelu na čekanju'})).toHaveAttribute('href',`/rewards/control?campaign=${id}&wallet=${wallet}`);
 expect(c.signTransaction).not.toHaveBeenCalled();expect(calls.confirm).not.toHaveBeenCalled();expect(calls.recover).not.toHaveBeenCalled();
});
it('keeps an unsigned claim payment reserved and links its exact campaign, approval and claim',async()=>{
 const c=connection(),claimId='73000000-0000-4000-8000-000000000003',claim={...pending,context:{kind:'claim',setupId:id,approvalId:id,claimId,source:'immutable'}};c.request=vi.fn(async()=>({pending:claim,factory:null}));
 render(<I18nProvider initialLocale="en"><ControllerCreationSetup connection={c} session={session} onRefresh={async()=>{}}/></I18nProvider>);
 expect(await screen.findByRole('link',{name:'Review pending claim payment'})).toHaveAttribute('href',`/rewards/control?campaign=${id}&approval=${id}&claim=${claimId}&wallet=${wallet}`);expect(calls.confirm).not.toHaveBeenCalled();expect(c.signTransaction).not.toHaveBeenCalled();
});
it('recovers a club claim through its own exact queue without signing automatically',async()=>{
 const c=connection(),claimId='73000000-0000-4000-8000-000000000003',claim={...pending,context:{kind:'clubClaim',setupId:id,approvalId:id,claimId,source:'immutable'}};c.request=vi.fn(async()=>({pending:claim,factory:null}));
 render(<I18nProvider initialLocale="en"><ControllerCreationSetup connection={c} session={session} onRefresh={async()=>{}}/></I18nProvider>);
 expect(await screen.findByRole('link',{name:'Review pending club claim payment'})).toHaveAttribute('href',`/rewards/control?campaign=${id}&approval=${id}&claim=${claimId}&wallet=${wallet}&claimKind=club`);
 expect(screen.getByText(/Club claim payment/)).toBeVisible();expect(calls.confirm).not.toHaveBeenCalled();expect(c.signTransaction).not.toHaveBeenCalled();expect(calls.recover).not.toHaveBeenCalled();
});
