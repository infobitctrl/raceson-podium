import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {NativeClaimDetail} from './ControllerClaims';
const m=vi.hoisted(()=>({read:vi.fn(),sign:vi.fn(),confirm:vi.fn()}));
vi.mock('../data/controllerClaims',()=>({getControllerClaims:vi.fn(),requestControllerClaim:m.read}));
vi.mock('../data/sponsorProgrammeWallet',()=>({signProgrammeClaim:m.sign}));
vi.mock('../data/controllerTransactions',async original=>({...await original<typeof import('../data/controllerTransactions')>(),confirmControllerJob:m.confirm}));
const id='7d000000-0000-4000-8000-000000000009',setupId='7d000000-0000-4000-8000-000000000010',approvalId='7d000000-0000-4000-8000-000000000011',wallet='0x'+'2'.repeat(40),address='0x'+'a'.repeat(40);
const base={schema:'raceson-sponsor-claim-view-v4',claimId:id,approvalId,chainId:10143,role:'operator',current:true,status:'awaiting_operator',sourceStamp:'b'.repeat(64),profileFingerprint:'c'.repeat(64),operatorAddress:wallet,address,claim:{amount:'1000000000000000000'},signing:{message:{amount:'1000000000000000000'}},transaction:null,receipt:null};
const transaction={chainId:10143,to:'0x'+'4'.repeat(40),data:'0xaa',value:'0',nonce:'10',gas:'200000',gasPrice:'100000000000'};
const job={id:setupId,context:{kind:'claim',claimId:id,setupId,approvalId,source:'immutable'},transaction,hash:null,confirmed:false,factory:null};
function connection(){return{subject:'did:privy:synthetic',wallets:[wallet],request:vi.fn().mockResolvedValue({pending:null}),getWallet:vi.fn().mockResolvedValue({address:wallet,provider:{}}),isCurrent:vi.fn(()=>true),signTransaction:vi.fn()};}
beforeEach(()=>{vi.clearAllMocks();m.read.mockResolvedValue(base);m.sign.mockResolvedValue('synthetic-proof');});
it('held readiness cannot sign or prepare a payment',async()=>{m.read.mockResolvedValue({...base,current:false,status:'held',signing:null});const c=connection();render(<NativeClaimDetail connection={c} wallet={wallet} setupId={setupId} approvalId={approvalId} id={id}/>);await screen.findByText('On hold · reward remains reserved');expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(m.sign).not.toHaveBeenCalled();expect(m.confirm).not.toHaveBeenCalled();});
it('requires exact operator acknowledgement and reuses its signature after lost write acknowledgement',async()=>{
 const c=connection();let lost=true;m.read.mockImplementation(async(_r,_w,_id,_a,body)=>{if(body){if(lost){lost=false;throw Error('uncertain');}return{...base,status:'ready_to_pay',signing:null};}return base;});
 render(<NativeClaimDetail connection={c} wallet={wallet} setupId={setupId} approvalId={approvalId} id={id}/>);
 const button=await screen.findByRole('button',{name:'Sign operator approval · Privy'});expect(button).toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(button);await screen.findByRole('alert');expect(m.sign).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Refresh claim status'}));await screen.findByRole('button',{name:'Sign operator approval · Privy'});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Sign operator approval · Privy'}));await waitFor(()=>expect(m.read.mock.calls.filter(c=>c[4]?.action==='operator')).toHaveLength(2));expect(m.sign).toHaveBeenCalledTimes(1);
});
it('changed signing context fails before opening the native wallet',async()=>{
 const c=connection();m.read.mockResolvedValueOnce(base).mockResolvedValueOnce({...base,signing:{message:{amount:'2'}}});render(<NativeClaimDetail connection={c} wallet={wallet} setupId={setupId} approvalId={approvalId} id={id}/>);
 await screen.findByRole('checkbox');fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Sign operator approval · Privy'}));await screen.findByRole('alert');expect(c.getWallet).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled();
});
it('payment shows its fee, requires a separate confirmation and resumes the same journal receipt',async()=>{
 const c=connection(),hash='0x'+'b'.repeat(64);m.read.mockResolvedValue({...base,status:'ready_to_pay',signing:null,transaction:{...transaction,from:wallet}});
 c.request.mockImplementation(async(_path,body)=>body?.action==='prepare'?job:body?.action==='resume'?{...job,hash,confirmed:true}:{pending:null});m.confirm.mockResolvedValue({...job,hash});
 render(<NativeClaimDetail connection={c} wallet={wallet} setupId={setupId} approvalId={approvalId} id={id}/>);fireEvent.click(await screen.findByRole('button',{name:'Prepare exact payment'}));
 const pay=await screen.findByRole('button',{name:'Pay exact reward · Privy'});expect(pay).toBeDisabled();expect(screen.getByText(/Maximum gas fee: 0.02 test MON/)).toBeInTheDocument();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(pay);
 fireEvent.click(await screen.findByRole('button',{name:'Verify payment receipt'}));await waitFor(()=>expect(c.request).toHaveBeenCalledWith('/transactions',{action:'resume',id:job.id}));expect(m.confirm).toHaveBeenCalledExactlyOnceWith(c,wallet,job);
});
