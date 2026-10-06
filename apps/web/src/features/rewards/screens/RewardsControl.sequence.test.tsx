import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import {keccak256,type Hex} from 'viem';
import RewardsControl,{type ControllerConnection} from './RewardsControl';
vi.mock('../components/ControllerWalletCard',()=>({default:()=>null}));
const id=(n:number)=>`73000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// Offline-only synthetic signer, never used with a provider.
const account=privateKeyToAccount(('0x'+'0'.repeat(63)+'1') as Hex),wallet=account.address.toLowerCase(),subject='did:privy:sequence-test';
const hash='a'.repeat(64),target='0x'+'44'.repeat(20);
const actions=['upload','upload','stage','activate'] as const;
const bounds=[[0,32],[32,58],[58,58],[58,58]];
const plan={version:4,launchId:id(2),setupRevision:1,configurationHash:hash,chainId:10143,funder:'0x'+'11'.repeat(20),operator:wallet,unallocatedTreasury:wallet,expiredTreasury:wallet,claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:['100','0','0','0','0','0'],budgetWei:'100'};
function fixture(){
 let index=0,current=true,changed=false,failRead=false;
 const initial={subject,wallet,chainId:10143};
 const state=()=>({schema:'raceson-sponsor-lifecycle-view-v4',approvalId:id(3),slot:0,current:true,publicationHash:'e'.repeat(64),publication:null,
  pot:{state:index===4?3:index===3?2:1,paused:false,paidWei:'0',allocatedWei:'80',claimDeadline:'0',entitlementCount:String(index?58:0)},
  transaction:index===4?null:{chainId:10143,from:wallet,to:target,value:'0',data:`0xa${index}`,action:actions[index],start:bounds[index][0],end:bounds[index][1],allocationDigest:'0xaa',binding:{}},receipts:[],
  review:{budgetWei:'100',allocatedWei:'80',retainedWei:'20',recipientCount:58,documentHash:changed?'b'.repeat(64):hash,groups:[]}});
 let job:ReturnType<typeof prepared>|undefined;
 function prepared(){return {id:id(10+index),context:{kind:'distribution' as const,setupId:id(1),approvalId:id(3),action:actions[index],start:bounds[index][0],end:bounds[index][1],source:'synthetic'},transaction:{chainId:10143 as const,to:target,data:`0xa${index}`,value:'0' as const,nonce:String(index),gas:'100000',gasPrice:'1'},hash:null as string|null,confirmed:false,factory:null};}
 let approve!:()=>Promise<void>,reject!:()=>void;
 const c:ControllerConnection={subject,wallets:[wallet],isCurrent:()=>current,getWallet:vi.fn(),
  signTransaction:vi.fn((_address,t)=>new Promise<string>((resolve,fail)=>{
   approve=async()=>resolve(await account.signTransaction({type:'legacy',chainId:10143,to:t.to as Hex,data:t.data as Hex,value:0n,nonce:Number(t.nonce),gas:BigInt(t.gas),gasPrice:BigInt(t.gasPrice)}));
   reject=()=>fail({code:4001});
  })),
  request:vi.fn(async(path,body)=>{
   const b=body as {action?:string;id?:string;signedTransaction?:Hex;expectedDocumentHash?:string}|undefined;
   if(path==='/access')return initial;
   if(path==='/campaigns')return [{setupId:id(1),name:'Synthetic sequence',execution:{plan,deploymentHash:'0x'+'dd'.repeat(32),fundingHash:'0x'+'ee'.repeat(32)},pots:[{slot:0,approvalId:id(3),ready:true}]}];
   if(path.includes('/allocations/')){expect(body).toBeUndefined();if(failRead&&index>0)throw Error('controller_chain_unavailable');return state();}
   if(path==='/transactions'&&b?.action==='prepare'){expect(b.expectedDocumentHash).toBe(hash);job=prepared();return job;}
   if(path==='/transactions'&&b?.action==='submit'){job={...job!,hash:keccak256(b.signedTransaction!)};return job;}
   if(path==='/transactions'&&b?.action==='resume'){expect(b.id).toBe(job?.id);const done={...job!,confirmed:true};index++;return done;}
   throw Error(`Unexpected request: ${path}`);
  })};
 return {c,approve:()=>approve(),reject:()=>reject(),changeSource:()=>{changed=true;},revoke:()=>{current=false;},failRead:()=>{failRead=true;}};
}
beforeEach(()=>{sessionStorage.clear();window.history.replaceState({},'','/rewards/control');});
afterEach(()=>{vi.restoreAllMocks();});
async function start(f:ReturnType<typeof fixture>){
 render(<RewardsControl connection={f.c} onLogout={()=>{}}/>);
 await screen.findByRole('button',{name:'Start remaining wallet steps · Privy'});
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'}));
 await screen.findByText('Confirm the transaction in the Privy wallet window to continue.');
}
async function confirm(f:ReturnType<typeof fixture>){
 await act(async()=>{await f.approve();});
 await screen.findByText('Waiting for transaction confirmation');
 // Exercise the same receipt checker as automatic polling, without timing flakiness.
 fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));
}
it('one start continues through two uploads, stage and activation with one wallet approval per transaction',async()=>{
 const f=fixture();await start(f);
 for(let i=0;i<4;i++){
  expect(f.c.signTransaction).toHaveBeenCalledTimes(i+1);await confirm(f);
  if(i<3)await screen.findByText('Confirm the transaction in the Privy wallet window to continue.');
 }
 expect(await screen.findByRole('heading',{name:'Claims open'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'Pause wallet steps'})).not.toBeInTheDocument();
 const calls=vi.mocked(f.c.request).mock.calls;
 expect(calls.filter(([path])=>path==='/access')).toHaveLength(1);
 expect(calls.filter(([path])=>path.includes('/allocations/'))).toHaveLength(5); // Initial + after each receipt, none before signing.
 expect(calls.filter(([,body])=>(body as {action?:string})?.action==='prepare')).toHaveLength(4);
 expect(sessionStorage.length).toBe(0);
});
it('automatic receipt polling also continues the next wallet step without another page click',async()=>{
 const f=fixture();await start(f);await act(async()=>{await f.approve();});
 await waitFor(()=>expect(f.c.signTransaction).toHaveBeenCalledTimes(2),{timeout:4000});
});
it.each(['pause','hide','reject','source','read failure','session'] as const)('stops automatic continuation after %s',async(kind)=>{
 const f=fixture();await start(f);
 if(kind==='reject'){
  await act(async()=>f.reject());expect(await screen.findByRole('alert')).toHaveTextContent('cancelled');
 }else{
  if(kind==='pause')fireEvent.click(screen.getByRole('button',{name:'Pause wallet steps'}));
  if(kind==='hide'){
   const visible=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
   fireEvent(document,new Event('visibilitychange'));visible.mockReturnValue('visible');fireEvent(document,new Event('visibilitychange'));
  }
  if(kind==='source')f.changeSource();
  if(kind==='read failure')f.failRead();
  if(kind==='session'){
   f.revoke();await act(async()=>{await f.approve();});expect(await screen.findByRole('alert')).toHaveTextContent('account or wallet changed');
  }else await confirm(f);
 }
 await act(async()=>{await Promise.resolve();});
 expect(f.c.signTransaction).toHaveBeenCalledTimes(1);
 expect(screen.queryByRole('button',{name:'Pause wallet steps'})).not.toBeInTheDocument();
 if(kind==='source')expect(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'})).toBeDisabled();
});
it('pausing during preparation prevents the pending response from opening a wallet',async()=>{
 const f=fixture(),request=f.c.request;let release!:(v:unknown)=>void;
 const response=new Promise<unknown>(resolve=>{release=resolve;});
 f.c.request=vi.fn(async(path,body)=>{const value=await request(path,body);if((body as {action?:string})?.action==='prepare'){await response;}return value;});
 render(<RewardsControl connection={f.c} onLogout={()=>{}}/>);
 await screen.findByRole('button',{name:'Start remaining wallet steps · Privy'});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'}));
 await screen.findByText('Checking account access, approved rewards and testnet gas before opening your wallet.');fireEvent.click(screen.getByRole('button',{name:'Pause wallet steps'}));
 await act(async()=>release(null));expect(await screen.findByRole('alert')).toHaveTextContent('Wallet steps paused');expect(f.c.signTransaction).not.toHaveBeenCalled();
});
it('reloading preserves receipt recovery but never resumes the wallet sequence automatically',async()=>{
 const f=fixture();
 const view=render(<RewardsControl connection={f.c} onLogout={()=>{}}/>);
 await screen.findByRole('button',{name:'Start remaining wallet steps · Privy'});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Start remaining wallet steps · Privy'}));
 await screen.findByText('Confirm the transaction in the Privy wallet window to continue.');await act(async()=>{await f.approve();});
 await screen.findByText('Waiting for transaction confirmation');view.unmount();
 render(<RewardsControl connection={f.c} onLogout={()=>{}}/>);
 await screen.findByText('Waiting for transaction confirmation');fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));
 expect(await screen.findByRole('button',{name:'Start remaining wallet steps · Privy'})).toBeDisabled();expect(f.c.signTransaction).toHaveBeenCalledTimes(1);
 expect(screen.queryByRole('button',{name:'Pause wallet steps'})).not.toBeInTheDocument();
});
