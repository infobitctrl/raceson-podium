import { getAddress,hashMessage,recoverMessageAddress,type Address,type Hex } from "viem";
import { createSiweMessage,parseSiweMessage } from "viem/siwe";
import { requireReward,RewardCalculationError } from "@raceson/domain/rewards";
import { isRewardWalletOrigin } from "@raceson/domain/rewards/environment";

/** Account-link proof only, never RacesOn login, MFA/age or payment consent.
 * No account/profile UUID, session token or personal information is signed. */
export type RewardWalletChallenge = {
  challengeId:string;chainId:10143|31337;address:Address;origin:string;nonce:string;issuedAt:string;expiresAt:string;
};
export function rewardWalletControlMessage(input:RewardWalletChallenge) {
  requireReward(typeof input.challengeId==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.challengeId),"invalid_reward_wallet_challenge");
  requireReward(typeof input.address==="string" && /^0x[0-9a-fA-F]{40}$/.test(input.address) && BigInt(input.address)!==0n,"invalid_reward_wallet_challenge");
  requireReward(typeof input.nonce==="string" && /^[0-9a-f]{64}$/.test(input.nonce),"invalid_reward_wallet_challenge");
  requireReward(typeof input.origin==="string" && typeof input.issuedAt==="string" && typeof input.expiresAt==="string","invalid_reward_wallet_challenge");
  let origin:URL;
  try{origin=new URL(input.origin);}catch{throw new RewardCalculationError("invalid_reward_wallet_origin");}
  requireReward(isRewardWalletOrigin(input.origin,input.chainId,true),"invalid_reward_wallet_origin");
  const issuedAt=new Date(input.issuedAt);const expirationTime=new Date(input.expiresAt);
  requireReward(Number.isSafeInteger(issuedAt.getTime()) && issuedAt.getTime()%1000===0 && expirationTime.getTime()-issuedAt.getTime()===600000,"invalid_reward_wallet_challenge");
  return createSiweMessage({address:getAddress(input.address),chainId:input.chainId,scheme:origin.protocol.slice(0,-1),domain:origin.host,
    uri:`${input.origin}/athlete/rewards`,version:"1",nonce:input.nonce,requestId:input.challengeId,issuedAt,expirationTime,
    statement:"Verify this wallet for my existing RacesOn account. This does not authorize a payment, transfer, or access to private keys."});
}

export async function verifyRewardWalletControl(input:RewardWalletChallenge,signature:Hex) {
  // Copy the exact message/address before the async recovery boundary. Expiry
  // and one-time use are enforced using fresh database time in the consume RPC.
  const message=rewardWalletControlMessage(input);const address=input.address.toLowerCase();
  requireReward(typeof signature==="string" && /^0x[0-9a-fA-F]{130}$/.test(signature),"invalid_reward_wallet_signature");
  const normalized=signature.toLowerCase() as Hex;const r=BigInt(`0x${normalized.slice(2,66)}`);const s=BigInt(`0x${normalized.slice(66,130)}`);
  requireReward(r>0n && s>0n && s<=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n && ["1b","1c"].includes(normalized.slice(130)),"invalid_reward_wallet_signature");
  let recovered:Address;
  try{recovered=await recoverMessageAddress({message,signature:normalized});}catch{throw new RewardCalculationError("invalid_reward_wallet_signature");}
  requireReward(recovered.toLowerCase()===address,"reward_wallet_signature_mismatch");
  return{messageHash:hashMessage(message),signature:normalized};
}

/** Browser-side guard before presenting a signing request. Reconstruct the
 * complete protocol message, not merely its domain or a substring. SQL remains
 * authoritative for the authenticated account, expiry and single use. */
export function validateRewardWalletControlMessage(input:{
  challengeId:string;address:Address;chainId:10143|31337;message:string;expiresAt:string;
},origin:string) {
  requireReward(isRewardWalletOrigin(origin,input.chainId),"invalid_reward_wallet_origin");
  requireReward(typeof input.message==="string" && input.message.length<=2048,"invalid_reward_wallet_challenge");
  const parsed=parseSiweMessage(input.message);
  requireReward(parsed.issuedAt instanceof Date && parsed.nonce!==undefined,"invalid_reward_wallet_challenge");
  const challenge:RewardWalletChallenge={challengeId:input.challengeId,address:input.address,chainId:input.chainId,
    origin,nonce:parsed.nonce,issuedAt:parsed.issuedAt.toISOString(),expiresAt:input.expiresAt};
  requireReward(rewardWalletControlMessage(challenge)===input.message,"invalid_reward_wallet_challenge");
  return challenge;
}
