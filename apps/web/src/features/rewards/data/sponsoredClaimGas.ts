import type {Address, Hex} from 'viem';
import type {RewardWalletProvider} from './browserWallet';

/** Simulate the validated, zero-value call without charging gas to the sender.
 * Privy's ordinary fee preparation otherwise caps execution by the athlete's
 * prize balance before its paymaster is involved. Only the gas limit is passed
 * onward: actual fees and payment remain in Privy's sponsored confirmation. */
export async function sponsoredClaimGas(provider:RewardWalletProvider,
 transaction:{from:Address;to:Address;data:Hex;value:0n;chainId:10143}) {
 const quantity=(value:unknown)=>{
  if(typeof value!=='string'||!/^0x[0-9a-f]+$/i.test(value))throw Error('invalid_wallet_response');
  return BigInt(value);
 };
 const estimate=quantity(await provider.request({method:'eth_estimateGas',params:[{
  from:transaction.from,to:transaction.to,data:transaction.data,value:'0x0',gasPrice:'0x0',
 },'pending']}));
 const gasLimit=(estimate*12n+9n)/10n;
 const price=quantity(await provider.request({method:'eth_gasPrice'}));
 // Keep the existing direct-club call ceiling and 0.5 test MON fee bound.
 if(estimate<=0n||gasLimit>2_000_000n||price<=0n||gasLimit*price>500_000_000_000_000_000n)
  throw Error('claim_gas_limit');
 return gasLimit;
}
