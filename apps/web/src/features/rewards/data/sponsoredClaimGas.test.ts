import {describe,it,expect,vi} from 'vitest';
import {sponsoredClaimGas} from './sponsoredClaimGas';
import type {RewardWalletProvider} from './browserWallet';
const transaction={from:`0x${'ab'.repeat(20)}` as const,to:`0x${'cd'.repeat(20)}` as const,
 data:'0x1234' as const,value:0n as const,chainId:10143 as const};
function provider(estimate:unknown='0x30d40',price:unknown='0x17bfac7c00'){
 return {request:vi.fn(async({method}:{method:string})=>method==='eth_estimateGas'?estimate:price),on:vi.fn(),removeListener:vi.fn()} satisfies RewardWalletProvider;
}
describe('sponsored claim gas simulation',()=>{
 it('estimates exact execution with zero fees and passes only a buffered gas limit to sponsorship',async()=>{
  const p=provider();expect(await sponsoredClaimGas(p,transaction)).toBe(240000n);
  expect(p.request).toHaveBeenNthCalledWith(1,{method:'eth_estimateGas',params:[{
   from:transaction.from,to:transaction.to,data:transaction.data,value:'0x0',gasPrice:'0x0',
  },'pending']});
  expect(p.request).toHaveBeenNthCalledWith(2,{method:'eth_gasPrice'});
  expect(p.request).toHaveBeenCalledTimes(2);
 });
 it.each([[null,'0x1'],['0x0','0x1'],['0x1c0000','0x1'],['0x30d40','0x0'],['0x30d40','0x100000000000'],['123','0x1']])('stops malformed or excessive estimates (%s, %s)',async(estimate,price)=>{
  await expect(sponsoredClaimGas(provider(estimate,price),transaction)).rejects.toThrow();
 });
 it('propagates a contract simulation failure without a gas guess, send or funding fallback',async()=>{
  const p=provider();p.request.mockRejectedValueOnce(Error('contract reverted'));
  await expect(sponsoredClaimGas(p,transaction)).rejects.toThrow('contract reverted');
  expect(p.request).toHaveBeenCalledOnce();
 });
});
