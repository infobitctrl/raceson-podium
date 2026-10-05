import {rewardSponsorCreation,type RewardAccountIdentity,type RewardLedgerRpc} from '@raceson/db/rewards';
import {walletRuntime,deploymentSignerFor} from './wallet-administration.js';
import {sponsorCreationSignerFromEnv} from './sponsor-creation-privy.js';
/** Select the journal's original gas wallet before consulting the active default. */
export async function resolveDeploymentSigner(env:Record<string,string|undefined>,identity?:RewardAccountIdentity,setupId?:string,rpc?:RewardLedgerRpc){
 const r=await walletRuntime(env,rpc);
 const raw=identity&&setupId?await rewardSponsorCreation(identity,setupId,{},rpc):null;
 if(raw&&typeof raw==='object'&&'sender' in raw){
  const c=r.deployments.find(d=>d.address===raw.sender);if(!c)return null;
  // Legacy baseline keeps its explicit provider-probe gate.
  const original=sponsorCreationSignerFromEnv(env);
  return original?.address===c.address?original:deploymentSignerFor(env,c);
 }
 if(!r.settings)return null;
 return r.revision===0?sponsorCreationSignerFromEnv(env):deploymentSignerFor(env,r.settings.deployment);
}
