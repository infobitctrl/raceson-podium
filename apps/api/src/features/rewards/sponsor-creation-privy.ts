import {z} from "zod";
import {createPublicKey,createPrivateKey,createHash} from "node:crypto";
import {PrivyClient} from "@privy-io/node";
import {createViemAccount} from "@privy-io/node/viem";
import {sponsorFactoryAbi,verifySponsorFactory} from "@raceson/rewards-chain/sponsor-v4";
import {canonicalRewardJson as canonical} from "@raceson/rewards-chain";
import {canaryPublicClient} from "@raceson/rewards-chain/canary-public-client";
import {getAddress,type Hex} from "viem";
import type {SponsorCreationSigner} from "./sponsor-creation-service.js";

const address=z.string().regex(/^0x[0-9a-f]{40}$/);
export const controllerDeploymentConfig=z.object({version:z.literal(1),appId:z.string(),walletId:z.string(),address,
 ownerId:z.string(),signerId:z.string(),policyId:z.string(),factory:address}).strict();
export type ControllerDeploymentConfig=z.infer<typeof controllerDeploymentConfig>;
export function controllerDeploymentRules(factory:string,_controller:string){return [{name:"Deploy RacesOn campaigns only",method:"eth_signTransaction" as const,action:"ALLOW" as const,conditions:[
 {field_source:"ethereum_transaction" as const,field:"chain_id" as const,operator:"eq" as const,value:"10143"},
 {field_source:"ethereum_transaction" as const,field:"value" as const,operator:"eq" as const,value:"0"},
 {field_source:"ethereum_transaction" as const,field:"to" as const,operator:"eq" as const,value:getAddress(factory)},
 {field_source:"ethereum_calldata" as const,field:"function_name",operator:"eq" as const,value:"deploy",abi:JSON.parse(JSON.stringify(sponsorFactoryAbi.filter(item=>item.type==="function")))},

 ]}];}
export const controllerDeploymentDigest=(c:ControllerDeploymentConfig)=>createHash("sha256").update(canonical({config:c,rules:controllerDeploymentRules(c.factory,c.address)})).digest("hex");
export function controllerDeploymentFromEnv(env:Record<string,string|undefined>){
 if(env.RACESON_REWARD_PORTAL_MODE!=="local-testnet"||!env.RACESON_CONTROLLER_DEPLOYMENT)return null;
 try{const c=controllerDeploymentConfig.parse(JSON.parse(env.RACESON_CONTROLLER_DEPLOYMENT));
 const owner=JSON.parse(env.RACESON_REWARD_CONTROLLER??"null");
 if(c.appId!==env.RACESON_REWARD_PRIVY_APP_ID||!owner?.wallet||!env.RACESON_SPONSOR_DEPLOYMENT_APP_SECRET||!env.RACESON_CONTROLLER_DEPLOYMENT_AUTH_KEY)return null;
 return c;}catch{return null;}
}
/** Verify actual provider authorization every time; the signing key must not own
 * the wallet or policy. App-secret possession cannot change user-owned policies. */
export async function verifyControllerDelegation(client:PrivyClient,c:ControllerDeploymentConfig,authorizationKey:string){
 const [wallet,policy,signer,owner]=await Promise.all([client.wallets().get(c.walletId),client.policies().get(c.policyId),client.keyQuorums().get(c.signerId),client.keyQuorums().get(c.ownerId)]);
 if(owner.authorization_threshold!==1||owner.authorization_keys.length||owner.user_ids?.length!==1||owner.key_quorum_ids?.length)throw Error("controller_delegation_unverified");
 if(wallet.address.toLowerCase()!==c.address||wallet.chain_type!=="ethereum"||wallet.owner_id!==c.ownerId||policy.owner_id!==c.ownerId||c.signerId===c.ownerId
 ||wallet.archived_at||wallet.imported_at||wallet.exported_at||wallet.policy_ids.length!==0)throw Error("controller_delegation_unverified");
 const publicKey=createPublicKey(createPrivateKey(authorizationKey.replace(/^wallet-auth:/,"").includes("BEGIN")?authorizationKey: {key:Buffer.from(authorizationKey.replace(/^wallet-auth:/,""),"base64"),format:"der",type:"pkcs8"})).export({format:"der",type:"spki"}).toString("base64");
 if(signer.authorization_threshold!==1||signer.authorization_keys.length!==1||signer.authorization_keys[0]?.public_key!==publicKey||signer.user_ids?.length||signer.key_quorum_ids?.length)throw Error("controller_delegation_unverified");
 if(policy.chain_type!=="ethereum"||policy.version!=="1.0"||canonical(policy.rules.map(({name,method,action,conditions})=>({name,method,action,conditions})))!==canonical(controllerDeploymentRules(c.factory,c.address)))throw Error("controller_delegation_unverified");
 const grants=wallet.additional_signers.filter(s=>s.signer_id===c.signerId);
 if(grants.length!==1||JSON.stringify(grants[0]!.override_policy_ids)!==JSON.stringify([c.policyId]))throw Error("controller_delegation_required");
}
export function sponsorCreationSignerFromEnv(env:Record<string,string|undefined>):SponsorCreationSigner|null{
 const c=controllerDeploymentFromEnv(env);if(!c)return null;
 const authorizationKey=env.RACESON_CONTROLLER_DEPLOYMENT_AUTH_KEY!,appSecret=env.RACESON_SPONSOR_DEPLOYMENT_APP_SECRET!;
 return {address:c.address,factoryAddress:c.factory as Hex,async verifyReady(){
 if(env.RACESON_CONTROLLER_DEPLOYMENT_VERIFIED!==controllerDeploymentDigest(c))throw Error("controller_delegation_unverified");
 const client=new PrivyClient({appId:c.appId,appSecret,maxRetries:0,timeout:15000});
 await verifyControllerDelegation(client,c,authorizationKey);await verifySponsorFactory(canaryPublicClient,c.factory as Hex);
 },async sign(tx){
  if(env.RACESON_CONTROLLER_DEPLOYMENT_VERIFIED!==controllerDeploymentDigest(c)||tx.to!==c.factory||tx.chainId!==10143||tx.value!=="0")throw Error("controller_delegation_unverified");
  const client=new PrivyClient({appId:c.appId,appSecret,maxRetries:0,timeout:15000});
  await verifyControllerDelegation(client,c,authorizationKey);
  const account=createViemAccount(client,{walletId:c.walletId,address:c.address as Hex,authorizationContext:{authorization_private_keys:[authorizationKey]}});
  return account.signTransaction({type:"legacy",chainId:10143,to:c.factory as Hex,data:tx.data as Hex,value:0n,nonce:Number(tx.nonce),gas:BigInt(tx.gas),gasPrice:BigInt(tx.gasPrice)});
 }};
}
