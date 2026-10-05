import { createServerAuthSupabaseClient,verifiedRequestIdentityFromClaims,type ServerEnv } from "@raceson/db";
import type { RewardAccountIdentity } from "@raceson/db/rewards";
import { RewardCalculationError } from "@raceson/domain/rewards";
import { rewardDemoTarget } from "@raceson/domain/rewards/environment";

type Claims=Parameters<typeof verifiedRequestIdentityFromClaims>[0];
type VerifyClaims=(token:string)=>Promise<{data:{claims:Claims}|null;error:unknown}>;
/** Authenticates the token with the existing Supabase verifier and issuer/aud/
 * role/sub/session rules. Never decode an unverified JWT or use user_metadata.
 * Each reward RPC independently checks current account/session existence. */
export async function authenticateRewardRequest(accessToken:string,env:ServerEnv,verifyClaims?:VerifyClaims):Promise<RewardAccountIdentity>{
  if(typeof accessToken!=="string" || !accessToken.length || accessToken.length>8192)throw new Error("Unauthorized");
  const fixedEnv={...env};const verify=verifyClaims??(token=>createServerAuthSupabaseClient(fixedEnv).auth.getClaims(token));
  let result:Awaited<ReturnType<VerifyClaims>>;
  try{result=await verify(accessToken);}catch{throw new RewardCalculationError("reward_auth_unavailable");}
  const identity=result.data?verifiedRequestIdentityFromClaims(result.data.claims,fixedEnv):null;
  if(result.error || !identity || result.data?.claims.is_anonymous!==false)throw new Error("Unauthorized");
  return identity;
}

export type RewardPortalConfig={chainId:10143|31337;origin:string};
/** Disabled unless explicitly configured. Never infer a chain from a browser
 * address, requested origin, host header or wallet's current selection. */
export function rewardPortalConfig(values:Record<string,string|undefined>,environment:Pick<ServerEnv,"appBaseUrl"|"supabaseUrl">):RewardPortalConfig|null{
  const mode=values.RACESON_REWARD_PORTAL_MODE;
  if(mode===undefined || mode==="disabled")return null;
  const target=rewardDemoTarget({mode,origin:values.RACESON_REWARD_DEMO_ORIGIN,supabaseUrl:values.RACESON_REWARD_DEMO_SUPABASE_URL});
  if(target&&target.origin===environment.appBaseUrl&&target.supabaseUrl===environment.supabaseUrl
    &&(mode==="testnet"||values.NODE_ENV!=="production"))return{chainId:target.chainId,origin:target.origin};
  throw new RewardCalculationError("reward_portal_configuration_required");
}
