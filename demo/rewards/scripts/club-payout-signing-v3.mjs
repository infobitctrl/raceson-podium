#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertOperatorSource,parseOperatorArguments,readOperatorCredentials} from './operator.mjs';
import {REWARD_OPERATOR_RPC_URL,rewardClubOperatorChainFetch} from './operator-transport.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const fail=()=>{throw Error('reward_payment_signing_config_invalid');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getOwnPropertySymbols(v).length===0
  && Object.getOwnPropertyNames(v).sort().join('\0')===[...keys].sort().join('\0')
  && keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const hex=(v,n)=>typeof v==='string'&&new RegExp(`^0x[0-9a-f]{${n}}$`).test(v)&&BigInt(v)!==0n;
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const scopeKeys=['uploadId','requestId','entitlementId','claimId','paymentId'];
export function normalizeClubPaymentSigningConfigV3(v,validateRelease){
  const ids=['draftId','uploadId','requestId','claimId','paymentId','attemptId','operatorUserId'];
  const addresses=['programmeAddress','operatorAddress','relayerAddress','recipientAddress'];
  if(!exact(v,['formatVersion','release',...ids,...addresses,'entitlementId','amountWei','maxGasCostWei','durationSeconds'])
    ||v.formatVersion!==3||!ids.every(k=>uuid(v[k]))||!addresses.every(k=>hex(v[k],40))
    ||new Set(addresses.map(k=>v[k])).size!==4||!hex(v.entitlementId,64)
    ||![v.amountWei,v.maxGasCostWei].every(n=>typeof n==='string'&&/^[1-9][0-9]{0,77}$/.test(n)&&BigInt(n)<1n<<256n)
    ||!Number.isInteger(v.durationSeconds)||v.durationSeconds<1||v.durationSeconds>1800)return fail();
  return{formatVersion:3,release:validateRelease(v.release),...Object.fromEntries([...ids,...addresses].map(k=>[k,v[k]])),
    entitlementId:v.entitlementId,amountWei:v.amountWei,maxGasCostWei:v.maxGasCostWei,durationSeconds:v.durationSeconds};
}
export function approvedClubSigningPlanV3(config,sourcePlanDigest,signing){
  const p=signing.plan;
  if(!/^[0-9a-f]{64}$/.test(sourcePlanDigest)||p.schema!=='raceson-club-payment-signing-plan-v3'||p.chainId!==10143
    ||![...scopeKeys,'attemptId','draftId','programmeAddress','operatorAddress','relayerAddress','recipientAddress','amountWei'].every(k=>p[k]===config[k])
    ||!hex(p.planHash,64)||BigInt(p.maxGasCostWei)>BigInt(config.maxGasCostWei))return fail();
  const plan={schemaVersion:3,kind:'raceson-club-payment-signing-approval-v3',sourcePlanDigest,config,signingPlan:p};
  return{...plan,planDigest:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
/** Signing has only read-only chain transport, even if a caller tries to use
 * the public client's generic request method. No raw transaction can leave it. */
export function clubPaymentSigningChainFetchV3(signal,fetchImpl){
  const transport=rewardClubOperatorChainFetch(signal,fetchImpl);
  return(input,init)=>{
    try{if(typeof init?.body!=='string'||Buffer.byteLength(init.body)>1024*1024
      ||JSON.parse(init.body)?.method==='eth_sendRawTransaction')throw Error();}
    catch{return Promise.reject(Error('reward_payment_signing_read_only'));}
    return transport(input,init);
  };
}
const help=`Isolated Monad testnet V3 club payout signing; no broadcast.
  plan --config <non-secret.json>
  run --config <non-secret.json> --confirm-plan <sha256>
Both commands authenticate and inspect one already prepared, consented payment.
Plan never accesses a key. Run uses only the existing dedicated relayer Keychain
account after exact plan approval. No athlete or Safe-owner keys, wallet generation or club consent signing.
Stores one immutable signed attempt privately; does not queue or pay recipients.
Credentials arrive only through a finite stdin pipe: accessToken, publishableKey, serverKey.
Never paste credentials into a terminal, argument, config, source file or chat.
No mainnet, production target, source-check or isolated-release-gate bypass.
`;
export async function main(args=process.argv.slice(2),log=console.log){
  const parsed=parseOperatorArguments(args);if(parsed.command==='help'){log(help);return;}
  let raw;try{const s=lstatSync(parsed.configPath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>128*1024)return fail();
    raw=JSON.parse(readFileSync(parsed.configPath,'utf8'));}catch{return fail();}
  assertOperatorSource(raw?.release?.sourceCommit);
  try{execFileSync(process.execPath,[resolve(root,'node_modules/typescript/bin/tsc'),'-b','packages/domain','packages/db','apps/api','--force'],
    {cwd:root,env:{PATH:process.env.PATH},timeout:60000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});}
  catch{throw Error('reward_payment_signing_build_required');}
  assertOperatorSource(raw.release.sourceCommit);
  const {validateDemoReleaseManifest}=await import('./release-manifest.mjs');
  const {readDemoReleaseSource}=await import('./release-source.mjs');
  const config=normalizeClubPaymentSigningConfigV3(raw,validateDemoReleaseManifest),source=readDemoReleaseSource(config.release);
  const {createClubPaymentSigningClientV3}=await import('../../../packages/db/dist/rewards/index.js');
  const {inspectClubPaymentSigningV3,signClubPaymentV3}=await import('../../../apps/api/dist/features/rewards/club-payment-signing-v3.js');
  const {createPublicClient,defineChain,http}=await import('viem');
  const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let deadline=Date.now()+config.durationSeconds*1000,timer=setTimeout(stop,config.durationSeconds*1000);
  const check=()=>{if(controller.signal.aborted||Date.now()>=deadline){stop();throw Error('reward_payment_signing_stopped');}};
  try{
    const credentials=await readOperatorCredentials(process.stdin,controller.signal);check();assertOperatorSource(config.release.sourceCommit);check();
    const target={mode:'testnet',chainId:10143,origin:config.release.origin,supabaseUrl:`https://${config.release.supabase.projectRef}.supabase.co`};
    const client=createClubPaymentSigningClientV3({target,...credentials,signal:controller.signal});
    const auth=await client.authenticate(credentials.accessToken,config.operatorUserId);check();
    deadline=Math.min(deadline,auth.expiresAtMs-5000);check();clearTimeout(timer);timer=setTimeout(stop,deadline-Date.now());
    const scope={chainId:10143,...Object.fromEntries(scopeKeys.map(k=>[k,config[k]]))};
    const rpc=async(name,a)=>{
      check();
      if(a.p_actor_user_id!==auth.identity.userId||a.p_actor_session_id!==auth.identity.sessionId||a.p_chain_id!==10143
        ||a.p_upload_id!==scope.uploadId||a.p_request_id!==scope.requestId||a.p_entitlement_id!==scope.entitlementId
        ||a.p_claim_id!==scope.claimId||a.p_payment_id!==scope.paymentId
        ||name==='service_change_reward_club_payment_v3'&&(a.p_action!=='attempt'||a.p_payload?.attemptId!==config.attemptId))return fail();
      const r=await client.rpc(name,a);check();return r;
    };
    const chain=defineChain({id:10143,name:'Monad testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:[REWARD_OPERATOR_RPC_URL]}}});
    const reader=createPublicClient({chain,transport:http(REWARD_OPERATOR_RPC_URL,{timeout:10000,retryCount:0,
      fetchFn:clubPaymentSigningChainFetchV3(controller.signal)}),cacheTime:0});
    const deps={rpc,reader,origin:target.origin,chainId:10143};
    const signing=await inspectClubPaymentSigningV3(auth.identity,{...scope,attemptId:config.attemptId},deps);check();
    const plan=approvedClubSigningPlanV3(config,source.planDigest,signing);
    if(parsed.command==='plan'){log(JSON.stringify({...plan,alreadyRecorded:signing.recorded,transactionHash:signing.transactionHash},null,2));return plan;}
    if(parsed.confirmation!==plan.planDigest)throw Error('reward_payment_signing_confirmation_required');
    assertOperatorSource(config.release.sourceCommit);check();
    const record=await signClubPaymentV3(auth.identity,{...scope,attemptId:config.attemptId,planHash:signing.plan.planHash},{...deps,signal:controller.signal,
      loadSigner:async()=>{
        check();assertOperatorSource(config.release.sourceCommit);check();
        const {publicTestnetWallet,loadTestnetOperatorAccount}=await import('./testnet-wallets.mjs');
        if(publicTestnetWallet('relayer').toLowerCase()!==config.relayerAddress)throw Error('reward_payment_signer_mismatch');
        const account=await loadTestnetOperatorAccount('relayer');check();
        return{address:account.address,signTransaction:tx=>{assertOperatorSource(config.release.sourceCommit);check();return account.signTransaction(tx);}};
      }});
    check();const output={...record,planDigest:plan.planDigest,sourceCommit:config.release.sourceCommit};log(JSON.stringify(output,null,2));return output;
  }finally{clearTimeout(timer);controller.abort();process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{await main();}catch{console.error('reward_payment_signing_command_failed');process.exitCode=1;}
}
