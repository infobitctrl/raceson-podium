import type {RewardWalletProvider} from './browserWallet';

/** Privy 3.42 strips fee fields from eth_estimateGas. Use the configured public
 * testnet RPC for these read-only calls; the wallet still owns account state,
 * signatures, events and the sponsored SDK transaction confirmation. */
export function sponsoredClaimSimulationProvider(wallet:RewardWalletProvider,rpcUrl:string):RewardWalletProvider {
 if(rpcUrl!=='https://testnet-rpc.monad.xyz')throw Error('claim_simulation_unavailable');
 let nextId=0;
 async function rpc(method:'eth_chainId'|'eth_estimateGas'|'eth_gasPrice',params:unknown[]=[]){
  const id=++nextId;
  const response=await fetch(rpcUrl,{method:'POST',credentials:'omit',redirect:'error',
   headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(20_000)});
  if(!response.ok)throw Error('claim_simulation_unavailable');
  const result:unknown=await response.json();
  if(!result||typeof result!=='object')throw Error('claim_simulation_unavailable');
  const value=result as {jsonrpc?:unknown;id?:unknown;result?:unknown;error?:unknown};
  if(value.jsonrpc!=='2.0'||value.id!==id||value.error!==undefined||typeof value.result!=='string'||!/^0x[0-9a-f]+$/i.test(value.result))
   throw Error('claim_simulation_unavailable');
  return value.result;
 }
 return {
  async request(input){
   if(input.method==='eth_estimateGas'){
    if(BigInt(await rpc('eth_chainId'))!==10143n)throw Error('wrong_network');
    return rpc('eth_estimateGas',input.params);
   }
   if(input.method==='eth_gasPrice')return rpc('eth_gasPrice');
   return wallet.request(input);
  },
  on:wallet.on.bind(wallet),removeListener:wallet.removeListener.bind(wallet),
 };
}
