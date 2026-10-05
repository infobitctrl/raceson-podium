import {beforeEach,expect,it,vi} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import {sponsorFactoryBuild} from '@raceson/rewards-chain/sponsor-v4';
import {confirmControllerJob,recoverControllerJob,type ControllerJob} from './controllerTransactions';
import type {ControllerConnection} from '../screens/RewardsControl';
// Synthetic fixture key used exclusively in offline tests.
const account=privateKeyToAccount(('0x'+'0'.repeat(63)+'1') as `0x${string}`),address=account.address.toLowerCase();
const job:ControllerJob={id:'71000000-0000-4000-8000-000000000001',context:{kind:'factory',build:sponsorFactoryBuild.creationCodeHash},transaction:{chainId:10143,data:sponsorFactoryBuild.bytecode,value:'0',nonce:'0',gas:'4841565',gasPrice:'102000000000'},hash:null,confirmed:false,factory:'0x'+'11'.repeat(20)};
const sign=(gas=4841565n)=>account.signTransaction({type:'legacy',chainId:10143,data:sponsorFactoryBuild.bytecode,value:0n,nonce:0,gas,gasPrice:102000000000n});
const connection=():ControllerConnection=>({subject:'did:privy:synthetic',wallets:[address],isCurrent:()=>true,getWallet:vi.fn(),signTransaction:vi.fn(async()=>sign()),request:vi.fn()});
beforeEach(()=>sessionStorage.clear());
it('blocks a wallet-modified gas limit before saving or submitting',async()=>{
 const c=connection();c.signTransaction=vi.fn(async()=>sign(4841566n));
 await expect(confirmControllerJob(c,address,job)).rejects.toThrow('controller_wallet_changed:gas');expect(c.request).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
});
it('recovers a lost submit response from saved exact bytes without another wallet signature',async()=>{
 const c=connection();c.request=vi.fn(async()=>{throw Error('lost response');});await expect(confirmControllerJob(c,address,job)).rejects.toThrow('lost response');
 expect(sessionStorage.length).toBe(1);const saved=JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
 c.request=vi.fn(async(_path,body)=>{expect(body).toEqual({action:'submit',id:job.id,signedTransaction:saved.signedTransaction});return{...job,hash:saved.hash};});
 const result=await recoverControllerJob(c,job);expect(result.hash).toBe(saved.hash);expect(c.signTransaction).toHaveBeenCalledTimes(1);expect(sessionStorage.length).toBe(0);
});
it('account change during confirmation cannot submit a transaction',async()=>{
 const c=connection();let active=true;c.isCurrent=()=>active;c.signTransaction=vi.fn(async()=>{const bytes=await sign();active=false;return bytes;});
 await expect(confirmControllerJob(c,address,job)).rejects.toThrow('controller_session_changed');expect(c.request).not.toHaveBeenCalled();
});

it('reports wallet, submission and exact-byte recovery without a second signature',async()=>{
 const c=connection(),progress=vi.fn();c.request=vi.fn(async()=>{throw Error('lost response');});
 await expect(confirmControllerJob(c,address,job,progress)).rejects.toThrow('lost response');
 expect(progress.mock.calls.map(([phase])=>phase)).toEqual(['wallet','submitting']);
 const saved=JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
 c.request=vi.fn(async()=>({...job,hash:saved.hash}));progress.mockClear();
 await confirmControllerJob(c,address,job,progress);
 expect(progress.mock.calls.map(([phase])=>phase)).toEqual(['recovering']);expect(c.signTransaction).toHaveBeenCalledTimes(1);
});
it('reports the distribution fee ceiling before requesting any signature',async()=>{
 const c=connection();
 const expensive={...job,context:{kind:'distribution' as const,setupId:job.id,approvalId:job.id,action:'upload' as const,start:0,end:58,source:'fixture'},transaction:{...job.transaction,to:'0x'+'11'.repeat(20),gas:'7326567',gasPrice:'102000000000'}};
 await expect(confirmControllerJob(c,address,expensive)).rejects.toThrow('controller_gas_limit');
 expect(c.signTransaction).not.toHaveBeenCalled();expect(c.request).not.toHaveBeenCalled();
});

it('missing browser signature explains recovery without signing or making a resume request',async()=>{
 const c=connection();await expect(recoverControllerJob(c,job)).rejects.toThrow('controller_local_signature_missing');
 expect(c.request).not.toHaveBeenCalled();expect(c.signTransaction).not.toHaveBeenCalled();
});
it('a changed session cannot submit a saved signature during recovery',async()=>{
 const c=connection();c.request=vi.fn(async()=>{throw Error('lost response');});await expect(confirmControllerJob(c,address,job)).rejects.toThrow('lost response');
 const saved=sessionStorage.getItem(sessionStorage.key(0)!);c.request=vi.fn();c.isCurrent=()=>false;
 await expect(recoverControllerJob(c,job)).rejects.toThrow('controller_session_changed');expect(c.request).not.toHaveBeenCalled();expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(saved);
});
