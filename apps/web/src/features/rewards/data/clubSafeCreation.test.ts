import {beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {rewardClubSafeCreationPlan,rewardClubSafeTestnetDependencies} from '@raceson/rewards-chain';
import type {Address,Hex} from 'viem';
import {clubCreationRecord,decodeClubCreationView,sendClubSafeCreation,clubSafeCreationHistory} from './clubSafeCreation';
const mock=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('@/lib/api',()=>({apiRequest:mock.api}));
const id='7d100000-0000-4000-8000-000000000301',hash=('0x'+'d'.repeat(64)) as Hex;
const address=(n:string)=>('0x'+n.repeat(40)) as Address;
const proxy=JSON.parse(readFileSync('../../contracts/node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxy.sol/SafeProxy.json','utf8')).bytecode as Hex;
function fixture(){const record={requestId:id,clubId:'7d100000-0000-4000-8000-000000000201',chainId:10143 as const,sender:address('a'),owners:['1','2','3'].map(address),saltNonce:'2',createdAt:'2026-10-06T01:00:00.000Z',current:true,transactions:[],verified:null};
 const plan=rewardClubSafeCreationPlan({environment:'monad-testnet',chainId:10143,sender:record.sender,owners:record.owners,saltNonce:2n,dependencies:rewardClubSafeTestnetDependencies},proxy);
 const prepared={plan,gas:'120000',gasPrice:'100',maximumFee:'12000000',balance:'12000000'};
 const wire=JSON.parse(JSON.stringify({schema:'podium-club-safe-creation-v1',record,prepared:{...prepared,observedAt:{number:'100',hash,timestamp:'1000'}}},(_,v)=>typeof v==='bigint'?v.toString():v));
 return{record,plan,prepared,wire};}
function provider(){const callbacks=new Map<string,()=>void>();const request=vi.fn(async({method}:{method:string})=>method==='eth_accounts'?[address('a')]:method==='eth_chainId'?'0x279f':method==='eth_getBalance'?'0xb71b00':method==='eth_sendTransaction'?hash:null);
 return{request,on:(e:string,f:()=>void)=>callbacks.set(e,f),removeListener:(e:string)=>callbacks.delete(e),callbacks};}
beforeEach(()=>mock.api.mockReset());
describe('explicit club Safe creation',()=>{
 it('rebuilds the pinned transaction and rejects substituted owners, fee, value, destination and receipt sequencing',()=>{
  const f=fixture();expect(decodeClubCreationView(f.wire,id).prepared?.plan).toEqual(f.plan);
  const changes:((w:typeof f.wire)=>void)[]=[w=>w.prepared.plan.transaction.value='1',w=>w.prepared.plan.transaction.to=address('f'),w=>w.prepared.maximumFee='1',w=>w.record.owners.reverse(),w=>w.record.current=false,w=>w.prepared.plan.initializer='0x1234',w=>w.record.requestId=id.replace('301','302')];
  for(const change of changes){const w=structuredClone(f.wire);change(w);expect(()=>decodeClubCreationView(w,id)).toThrow();}
  expect(()=>clubCreationRecord.parse({...f.record,verified:{transactionHash:hash,safeAddress:address('f'),blockNumber:'100',blockHash:hash,initializerHash:hash}})).toThrow();
  const receipt={transactionHash:hash,safeAddress:address('f'),blockNumber:(2n**64n).toString(),blockHash:hash,initializerHash:hash};
  expect(()=>clubCreationRecord.parse({...f.record,transactions:[{transactionHash:hash}],verified:receipt})).toThrow();
 });
 it('sends only one exact zero-value creation after account, chain and balance checks, then removes listeners',async()=>{
  const f=fixture(),p=provider();expect(await sendClubSafeCreation(p,f,()=>true)).toBe(hash);
  const calls=p.request.mock.calls.map(([v])=>v);expect(calls.map(v=>v.method)).toEqual(['eth_accounts','eth_chainId','eth_getBalance','eth_accounts','eth_chainId','eth_sendTransaction']);
  expect(calls.at(-1)).toEqual({method:'eth_sendTransaction',params:[{from:f.plan.transaction.from,to:f.plan.transaction.to,data:f.plan.transaction.data,value:'0x0',chainId:'0x279f',gas:'0x1d4c0',gasPrice:'0x64'}]});expect(p.callbacks.size).toBe(0);
 });
 it('freezes intent before async IO and retires account/session changes or insufficient funds before sending',async()=>{
  const f=fixture(),p=provider(),original=p.request.getMockImplementation()!;
  p.request.mockImplementation(async(v)=>{f.record.owners.reverse();return original(v);});await sendClubSafeCreation(p,f,()=>true);
  for(const mutation of ['event','session','balance','chain']){const fresh=fixture(),q=provider(),base=q.request.getMockImplementation()!;let current=true;
   q.request.mockImplementation(async(v)=>{if(v.method==='eth_getBalance'){if(mutation==='event')q.callbacks.get('accountsChanged')?.();if(mutation==='session')current=false;if(mutation==='balance')return '0x0';}if(mutation==='chain'&&v.method==='eth_chainId')return '0x1';return base(v);});
   await expect(sendClubSafeCreation(q,fresh,()=>current)).rejects.toThrow();expect(q.request.mock.calls.some(([v])=>v.method==='eth_sendTransaction')).toBe(false);expect(q.callbacks.size).toBe(0);
  }
 });
 it('never retries an ambiguous wallet response or an event after broadcast',async()=>{
  for(const changed of [false,true]){const f=fixture(),p=provider(),base=p.request.getMockImplementation()!;p.request.mockImplementation(async(v)=>{if(v.method==='eth_sendTransaction'){if(changed)p.callbacks.get('disconnect')?.();return changed?hash:null;}return base(v);});
   await expect(sendClubSafeCreation(p,f,()=>true)).rejects.toThrow();expect(p.request.mock.calls.filter(([v])=>v.method==='eth_sendTransaction')).toHaveLength(1);expect(p.callbacks.size).toBe(0);}
 });
 it('accepts only bounded stable creation history and uses no-store transport',async()=>{
  const f=fixture();mock.api.mockResolvedValue({items:[f.record],nextCursor:null});await clubSafeCreationHistory();expect(mock.api).toHaveBeenCalledWith({path:'/v1/rewards/demo-copy/club-creations',cache:'no-store'});
  mock.api.mockResolvedValue({items:[f.record],nextCursor:id});await expect(clubSafeCreationHistory()).rejects.toThrow();
  mock.api.mockResolvedValue({items:[f.record,f.record],nextCursor:null});await expect(clubSafeCreationHistory()).rejects.toThrow();
 });
});
