import {rewardSponsorCreation,type RewardAccountIdentity,type RewardLedgerRpc} from '@raceson/db/rewards';
import {walletRuntime,deploymentSignerFor,hostedWalletEnvironment} from './wallet-administration.js';
import {sponsorCreationSignerFromEnv} from './sponsor-creation-privy.js';
/** Select the journal's original gas wallet before consulting the active default. */
export async function resolveDeploymentSigner(env:Record<string,string|undefined>,identity?:RewardAccountIdentity,setupId?:string,rpc?:RewardLedgerRpc,runtimeRpc?:RewardLedgerRpc,protocolVersion?:4|5){
 const hosted=hostedWalletEnvironment(env);
 const r=await walletRuntime(env,runtimeRpc??(hosted?undefined:rpc));
 const baseline=hosted?JSON.parse(env.RACESON_CONTROLLER_DEPLOYMENT??'null'):null;
 const raw=identity&&setupId?await rewardSponsorCreation(identity,setupId,{},rpc):null;
 if(raw&&typeof raw==='object'&&'sender' in raw){
  const destination='transaction' in raw&&raw.transaction&&typeof raw.transaction==='object'&&'to' in raw.transaction?raw.transaction.to:undefined;
  const c=r.deployments.find(d=>d.address===raw.sender&&(destination===undefined||d.factory===destination)&&(protocolVersion===undefined||(d.protocolVersion??4)===protocolVersion));if(!c)return null;
  if(hosted&&c.walletId===baseline?.walletId)return null;
  // Legacy baseline keeps its explicit provider-probe gate.
  const original=sponsorCreationSignerFromEnv(env);
  return original?.address===c.address&&original.factoryAddress===c.factory?original:deploymentSignerFor(env,c);
 }
 if(!r.settings)return null;
 // A saved execution plan can predate the upgrade without having reserved a
 // transaction yet. Its immutable version still selects the matching factory.
 if(protocolVersion!==undefined){
  const c=r.deployments.find(d=>(d.protocolVersion??4)===protocolVersion&&(!hosted||r.revision>0&&d.walletId!==baseline?.walletId));
  if(!c)return null;
  const original=sponsorCreationSignerFromEnv(env);
  return original?.address===c.address&&original.factoryAddress===c.factory?original:deploymentSignerFor(env,c);
 }
 if(hosted&&(r.revision===0||r.settings.deployment.walletId===baseline?.walletId))return null;
 return r.revision===0?sponsorCreationSignerFromEnv(env):deploymentSignerFor(env,r.settings.deployment);
}
