import {decodeFunctionData,type Hex} from "viem";
import {sponsorLifecycleDataV4,type SponsorLifecycleInputV4} from "@raceson/rewards-chain/sponsor-lifecycle-v4";
import {sponsorClaimMessagesV4,verifySponsorClaimProofV4,encodeSponsorClaimV4} from "@raceson/rewards-chain/sponsor-claims-v4";
import {canonicalRewardJson} from "@raceson/rewards-chain";
import {parseAbi} from "viem";
import type {SponsorClubClaim} from "./sponsorClubClaims";
import {verifySponsorClubSignatures} from "./sponsorClubWallet";
import type {RewardWalletProvider} from "./browserWallet";
import type {SponsorLifecycle,SponsorClaim} from "./sponsorProgramme";
const abi=parseAbi(["function claim(bytes32 entitlementId,address recipient,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes operatorSignature,bytes recipientSignature)"]);
export function claimMessageV4(v:SponsorClaim|SponsorClubClaim){
 if(!v.claim||!v.context||v.context.chainId!==v.chainId||v.context.environment!==(v.chainId===31337?"local-simulation":"monad-testnet"))throw Error("invalid_claim");
 const c={...v.claim,pot:v.claim.pot!,entitlementId:v.claim.entitlementId as Hex,recipient:v.claim.recipient as Hex,amount:BigInt(v.claim.amount),nonce:BigInt(v.claim.nonce),issuedAt:BigInt(v.claim.issuedAt),expiresAt:BigInt(v.claim.expiresAt),allocationDigest:v.claim.allocationDigest as Hex};
 const context={environment:v.context.environment!,chainId:v.context.chainId!,verifyingContract:v.context.verifyingContract as Hex};
 return{claim:c,context,messages:sponsorClaimMessagesV4(context,c)};
}
export async function sendProgrammeTransaction(provider:RewardWalletProvider,view:SponsorLifecycle|SponsorClaim|SponsorClubClaim,current:()=>boolean){
 const t=view.transaction;if(!t)throw Error("transaction_unavailable");
 if("binding"in t){const b=JSON.parse(JSON.stringify(t.binding)) as SponsorLifecycleInputV4;b.awards=b.awards.map(a=>({...a,amount:BigInt(a.amount)}));
  if(t.from!==b.plan.operator||t.to!==b.campaignAddress||t.chainId!==b.plan.chainId||t.data!==sponsorLifecycleDataV4(b,t.action,t.start,t.end))throw Error("invalid_transaction");
 }else{const p=claimMessageV4(view as SponsorClaim|SponsorClubClaim),d=decodeFunctionData({abi,data:t.data as Hex});
  if(d.functionName!=="claim"||t.to!==p.context.verifyingContract||t.chainId!==p.context.chainId)throw Error("invalid_transaction");
  if(view.schema==="raceson-sponsor-club-claim-view-v4"){
   if(t.from!==view.operatorAddress)throw Error("invalid_transaction");await verifySponsorClubSignatures(view,d.args[6]);
  }else await verifySponsorClaimProofV4(p.context,p.claim,"recipient",t.from as Hex,d.args[6]);await verifySponsorClaimProofV4(p.context,p.claim,"operator",t.from as Hex,d.args[5]);
  if(encodeSponsorClaimV4(p.context,p.claim,{operator:d.args[5],recipient:d.args[6]})!==t.data)throw Error("invalid_transaction");
 }
 let changed=false;const onChange=()=>{changed=true;},events=["accountsChanged","chainChanged","disconnect"];
 const active=()=>{if(changed||!current())throw Error("wallet_changed");};
 const check=async()=>{active();const a=await provider.request({method:"eth_accounts"}),c=await provider.request({method:"eth_chainId"});active();if(!Array.isArray(a)||typeof a[0]!=="string"||a[0].toLowerCase()!==t.from||typeof c!=="string"||!/^0x[0-9a-f]+$/i.test(c)||BigInt(c)!==BigInt(t.chainId))throw Error("wallet_changed");};
 const quantity=(x:unknown)=>{if(typeof x!=="string"||!/^0x[0-9a-f]+$/i.test(x))throw Error("invalid_wallet_response");return BigInt(x);};
 events.forEach(e=>provider.on(e,onChange));try{await check();const tx={from:t.from,to:t.to,data:t.data,value:"0x0",chainId:`0x${t.chainId.toString(16)}`};
 const estimate=await provider.request({method:"eth_estimateGas",params:[tx]});
 // Privy returns a bigint estimate; other RPC quantities remain strict hex.
 const gas=((typeof estimate==="bigint"?estimate:quantity(estimate))*12n+9n)/10n,price=quantity(await provider.request({method:"eth_gasPrice"}));
 if(gas<=0n||gas>30_000_000n||price<=0n||gas*price>500_000_000_000_000_000n)throw Error("sponsor_gas_limit");await check();
 const h=await provider.request({method:"eth_sendTransaction",params:[{...tx,gas:`0x${gas.toString(16)}`,gasPrice:`0x${price.toString(16)}`}]});
 if(typeof h!=="string"||!/^0x[0-9a-f]{64}$/i.test(h))throw Error("transaction_unknown");return h.toLowerCase();
 }finally{events.forEach(e=>provider.removeListener(e,onChange));}
}
export async function signProgrammeClaim(provider:RewardWalletProvider,v:SponsorClaim|SponsorClubClaim,current:()=>boolean){
 const p=claimMessageV4(v),typed=v.role==="recipient"?p.messages.consent:p.messages.authorization;
 if(canonicalRewardJson(typed)!==canonicalRewardJson(v.signing)||!v.current)throw Error("invalid_claim");
 const signer=v.role==="recipient"?v.address:v.operatorAddress;
 const a=await provider.request({method:"eth_accounts"}),c=await provider.request({method:"eth_chainId"});
 if(!current()||!Array.isArray(a)||typeof a[0]!=="string"||signer&&a[0].toLowerCase()!==signer||typeof c!=="string"||!/^0x[0-9a-f]+$/i.test(c)||BigInt(c)!==BigInt(v.chainId))throw Error("wallet_changed");
 let changed=false;const onChanged=()=>{changed=true;};const events=["accountsChanged","chainChanged","disconnect"];
 events.forEach(e=>provider.on(e,onChanged));try {
 const json=canonicalRewardJson({...typed,types:{...typed.types,EIP712Domain:[{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}]}});
 const signature=await provider.request({method:"eth_signTypedData_v4",params:[signer,json]});
 if(changed||!current()||typeof signature!=="string"||!/^0x[0-9a-f]{130}$/i.test(signature))throw Error("wallet_changed");
 const after=await provider.request({method:"eth_accounts"}),network=await provider.request({method:"eth_chainId"});
 if(changed||!current()||!Array.isArray(after)||typeof after[0]!=="string"||after[0].toLowerCase()!==signer||network!==c)throw Error("wallet_changed");
 await verifySponsorClaimProofV4(p.context,p.claim,v.role,v.operatorAddress as Hex,signature as Hex);return signature.toLowerCase();
 }finally{events.forEach(e=>provider.removeListener(e,onChanged));}
}
