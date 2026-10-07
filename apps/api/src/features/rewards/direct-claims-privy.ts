import {z} from 'zod';
import {PrivyClient} from '@privy-io/node';
import {createViemAccount} from '@privy-io/node/viem';
import {walletBindingMessageV1} from '@raceson/rewards-chain/sponsor-direct-claims-v5';
import type {IdentityBindingIssuerV1} from './direct-claims-v5-service.js';
import type {Address} from 'viem';
const config=z.object({version:z.literal(1),appId:z.string().min(1),walletId:z.string().min(1),
 address:z.string().regex(/^0x[0-9a-f]{40}$/),registry:z.string().regex(/^0x[0-9a-f]{40}$/)}).strict();
/** A separately provisioned platform credential issuer, never an athlete wallet,
 * creation-gas wallet, reviewer wallet or recipient-consent signer. No creation,
 * owner change, key export, provider update or transaction method is exposed. */
export function directIdentityIssuerFromEnv(env:Record<string,string|undefined>):IdentityBindingIssuerV1|null{
 if(!env.RACESON_REWARD_IDENTITY_ISSUER_V1||!env.RACESON_REWARD_IDENTITY_APP_SECRET)return null;
 let c:z.infer<typeof config>;
 try{c=config.parse(JSON.parse(env.RACESON_REWARD_IDENTITY_ISSUER_V1));}catch{return null;}
 if(c.appId!==env.RACESON_REWARD_PRIVY_APP_ID||BigInt(c.address)===0n||BigInt(c.registry)===0n)return null;
 return {address:c.address as Address,async sign(context,binding){
  if(context.chainId!==10143||context.registry.toLowerCase()!==c.registry||![0,1].includes(binding.beneficiaryKind))throw Error('identity_binding_unavailable');
  const now=BigInt(Math.floor(Date.now()/1000));
  if(binding.issuedAt>now||binding.expiresAt<=now||binding.expiresAt-binding.issuedAt>600n)throw Error('identity_binding_unavailable');
  const client=new PrivyClient({appId:c.appId,appSecret:env.RACESON_REWARD_IDENTITY_APP_SECRET!,maxRetries:0,timeout:15000});
  const wallet=await client.wallets().get(c.walletId);
  if(wallet.address.toLowerCase()!==c.address||wallet.chain_type!=='ethereum'||wallet.owner_id!==null
   ||wallet.additional_signers.length||wallet.policy_ids.length||wallet.archived_at||wallet.exported_at||wallet.imported_at)throw Error('identity_binding_unavailable');
  const signer=createViemAccount(client,{walletId:c.walletId,address:c.address as Address});
  return signer.signTypedData(walletBindingMessageV1(context,binding));
 }};
}
