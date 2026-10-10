import {afterEach,expect,it,vi} from 'vitest';
import {sponsoredClaimSimulationProvider} from './sponsoredClaimSimulationProvider';
import {sponsoredClaimGas} from './sponsoredClaimGas';
const url='https://testnet-rpc.monad.xyz';
const transaction={from:`0x${'ab'.repeat(20)}` as const,to:`0x${'cd'.repeat(20)}` as const,data:'0x1234' as const,value:0n as const,chainId:10143 as const};
function setup(values:Record<string,unknown>={}){
 const wallet={request:vi.fn(async(input:{method:string;params?:unknown[]})=>{
  // Installed Privy strips zero-fee fields and then caps by sender balance.
  if(input.method==='eth_estimateGas')throw Error('intrinsic gas greater than limit');
  return input.method==='eth_accounts'?[transaction.from]:'0x279f';
 }),on:vi.fn(),removeListener:vi.fn()};
 const fetcher=vi.fn(async(_url:unknown,options?:RequestInit)=>{
  const input=JSON.parse(String(options?.body));
  return new Response(JSON.stringify({jsonrpc:'2.0',id:input.id,result:({eth_chainId:'0x279f',eth_estimateGas:'0x30d40',eth_gasPrice:'0x17bfac7c00',...values})[input.method]}));
 });
 vi.stubGlobal('fetch',fetcher);
 return {wallet,fetcher,provider:sponsoredClaimSimulationProvider(wallet,url)};
}
afterEach(()=>vi.unstubAllGlobals());
it('preserves the exact zero-fee call through public RPC without Privy estimate rewriting',async()=>{
 const {provider,wallet,fetcher}=setup();
 expect(await sponsoredClaimGas(provider,transaction)).toBe(240000n);
 const requests=fetcher.mock.calls.map(([,options])=>JSON.parse(String(options?.body)));
 expect(requests.map(r=>r.method)).toEqual(['eth_chainId','eth_estimateGas','eth_gasPrice']);
 expect(requests[1].params).toEqual([{from:transaction.from,to:transaction.to,data:transaction.data,value:'0x0',gasPrice:'0x0'},'pending']);
 expect(wallet.request).not.toHaveBeenCalled();
 expect(fetcher.mock.calls.every(([target,options])=>target===url&&options?.credentials==='omit'&&options.redirect==='error'&&options.signal)).toBe(true);
});
it('keeps wallet identity, network and subscriptions with the existing wallet',async()=>{
 const {provider,wallet,fetcher}=setup(),listener=vi.fn();
 expect(await provider.request({method:'eth_accounts'})).toEqual([transaction.from]);
 expect(await provider.request({method:'eth_chainId'})).toBe('0x279f');
 provider.on('accountsChanged',listener);provider.removeListener('accountsChanged',listener);
 expect(wallet.on).toHaveBeenCalledWith('accountsChanged',listener);
 expect(wallet.removeListener).toHaveBeenCalledWith('accountsChanged',listener);
 expect(fetcher).not.toHaveBeenCalled();
});
it('stops before simulation on a different chain',async()=>{
 const {provider,fetcher,wallet}=setup({eth_chainId:'0x1'});
 await expect(sponsoredClaimGas(provider,transaction)).rejects.toThrow('wrong_network');
 expect(fetcher).toHaveBeenCalledOnce();expect(wallet.request).not.toHaveBeenCalled();
});
it.each([null,'bad',undefined])('rejects malformed RPC quantities without wallet fallback (%s)',async(result)=>{
 const {provider,wallet}=setup({eth_estimateGas:result});
 await expect(sponsoredClaimGas(provider,transaction)).rejects.toThrow('claim_simulation_unavailable');
 expect(wallet.request).not.toHaveBeenCalled();
});
it('does not retry, guess gas or ask the wallet to estimate after an RPC error',async()=>{
 const {provider,wallet,fetcher}=setup();
 fetcher.mockRejectedValueOnce(Error('network unavailable'));
 await expect(sponsoredClaimGas(provider,transaction)).rejects.toThrow('network unavailable');
 expect(fetcher).toHaveBeenCalledOnce();expect(wallet.request).not.toHaveBeenCalled();
});
it('rejects RPC errors, failed HTTP responses and mismatched response IDs',async()=>{
 for(const response of [new Response('{}',{status:503}),new Response(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32000}})),new Response(JSON.stringify({jsonrpc:'2.0',id:999,result:'0x279f'}))]){
  const {provider,wallet,fetcher}=setup();fetcher.mockResolvedValueOnce(response);
  await expect(sponsoredClaimGas(provider,transaction)).rejects.toThrow('claim_simulation_unavailable');
  expect(wallet.request).not.toHaveBeenCalled();
 }
});
it('rejects an unconfigured endpoint before any call',()=>{
 const {wallet,fetcher}=setup();expect(()=>sponsoredClaimSimulationProvider(wallet,'https://example.com')).toThrow('claim_simulation_unavailable');
 expect(fetcher).not.toHaveBeenCalled();expect(wallet.request).not.toHaveBeenCalled();
});
