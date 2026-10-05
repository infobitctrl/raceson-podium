#!/usr/bin/env node
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertOperatorSource,parseOperatorArguments,readOperatorCredentials} from './operator.mjs';
import {programmeOperatorExitCodeV3} from './programme-operator-v3.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const fail=()=>{throw Error('reward_payment_operator_config_invalid');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getOwnPropertySymbols(v).length===0
  && Object.getOwnPropertyNames(v).sort().join('\0')===[...keys].sort().join('\0')
  && keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const hex=(v,n)=>typeof v==='string'&&new RegExp(`^0x[0-9a-f]{${n}}$`).test(v)&&BigInt(v)!==0n;
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export function normalizeClubPaymentOperatorConfigV3(v,validateRelease,captureJobs){
  if(!exact(v,['formatVersion','release','draftId','programmeAddress','operatorAddress','relayerAddress','operatorUserId','durationSeconds',
    'maxGasCostWei','maxPayoutWei','jobs']) || v.formatVersion!==3 || !uuid(v.draftId)||!uuid(v.operatorUserId)
    || ![v.programmeAddress,v.operatorAddress,v.relayerAddress].every(a=>hex(a,40))
    || new Set([v.programmeAddress,v.operatorAddress,v.relayerAddress]).size!==3
    || !Number.isInteger(v.durationSeconds)||v.durationSeconds<1||v.durationSeconds>1800
    || ![v.maxGasCostWei,v.maxPayoutWei].every(n=>typeof n==='string'&&/^[1-9][0-9]{0,77}$/.test(n)&&BigInt(n)<1n<<256n))return fail();
  const jobs=captureJobs(v.jobs).map(j=>({...j,amountWei:j.amountWei.toString()}));
  if(jobs.reduce((n,j)=>n+BigInt(j.amountWei),0n)>BigInt(v.maxPayoutWei))return fail();
  return{formatVersion:3,release:validateRelease(v.release),draftId:v.draftId,programmeAddress:v.programmeAddress,operatorAddress:v.operatorAddress,
    relayerAddress:v.relayerAddress,operatorUserId:v.operatorUserId,durationSeconds:v.durationSeconds,maxGasCostWei:v.maxGasCostWei,maxPayoutWei:v.maxPayoutWei,jobs};
}
export const clubPaymentOperatorExitCodeV3=programmeOperatorExitCodeV3;
const help=`Isolated Monad testnet V3 club payout delivery.
  plan --config <non-secret.json>
  run --config <non-secret.json> --confirm-plan <sha256>
Runs only exact already queued/signed club payout jobs with actual consent.
An explicit recipient/amount list, total payout cap and worst-case gas cap are required.
No keys, signing, payment creation, profile claiming, queue creation, funding or deployment.
Stops at the first unconfirmed job. Rerun the SAME list to recover exact receipts.
Credentials arrive only through a finite stdin pipe: accessToken, publishableKey, serverKey.
Never paste credentials into a terminal, argument, config, source file or chat.
No mainnet, production-project, source-check or isolated-release-gate bypass.
`;
export async function main(args=process.argv.slice(2),log=console.log){
  const parsed=parseOperatorArguments(args);if(parsed.command==='help'){log(help);return;}
  let raw;try{const s=lstatSync(parsed.configPath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>128*1024)return fail();
    raw=JSON.parse(readFileSync(parsed.configPath,'utf8'));}catch{return fail();}
  assertOperatorSource(raw?.release?.sourceCommit);
  try{execFileSync(process.execPath,[resolve(root,'node_modules/typescript/bin/tsc'),'-b','packages/domain','packages/db','apps/api','--force'],
    {cwd:root,env:{PATH:process.env.PATH},timeout:60000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});}
  catch{throw Error('reward_payment_operator_build_required');}
  assertOperatorSource(raw.release.sourceCommit);
  const {validateDemoReleaseManifest}=await import('./release-manifest.mjs');
  const {readDemoReleaseSource}=await import('./release-source.mjs');
  const {captureClubPaymentOperatorJobsV3,runAuthenticatedClubPaymentOperatorV3}=await import('../../../apps/api/dist/features/rewards/club-payment-operator-v3.js');
  const config=normalizeClubPaymentOperatorConfigV3(raw,validateDemoReleaseManifest,captureClubPaymentOperatorJobsV3),source=readDemoReleaseSource(config.release);
  const plan={schemaVersion:3,kind:'raceson-club-payment-operator-plan-v3',sourcePlanDigest:source.planDigest,config};
  const planDigest=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  if(parsed.command==='plan'){const r={...plan,planDigest};log(JSON.stringify(r,null,2));return r;}
  if(parsed.confirmation!==planDigest)throw Error('reward_payment_operator_confirmation_required');
  const {createPublicClient,defineChain,http}=await import('viem');
  const {REWARD_OPERATOR_RPC_URL:rpcUrl,rewardClubOperatorChainFetch}=await import('./operator-transport.mjs');
  const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const credentials=await readOperatorCredentials(process.stdin,controller.signal);assertOperatorSource(config.release.sourceCommit);
    const chain=defineChain({id:10143,name:'Monad testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:[rpcUrl]}}});
    const reader=createPublicClient({chain,transport:http(rpcUrl,{timeout:10000,retryCount:0,fetchFn:rewardClubOperatorChainFetch(controller.signal)}),cacheTime:0});
    const r=await runAuthenticatedClubPaymentOperatorV3({target:{mode:'testnet',chainId:10143,origin:config.release.origin,
      supabaseUrl:`https://${config.release.supabase.projectRef}.supabase.co`},...credentials,draftId:config.draftId,programmeAddress:config.programmeAddress,
      operatorAddress:config.operatorAddress,relayerAddress:config.relayerAddress,operatorUserId:config.operatorUserId,workerId:randomUUID(),
      durationMs:config.durationSeconds*1000,maxGasCostWei:BigInt(config.maxGasCostWei),maxPayoutWei:BigInt(config.maxPayoutWei),jobs:config.jobs},
    // Source was checked before loading the runner and after credential input.
    // Keep the final send callback immediate: a blocking Git subprocess here
    // would delay the worker's just-checked session/deadline/lease send fence.
    {reader,signal:controller.signal,broadcast:bytes=>reader.request({method:'eth_sendRawTransaction',params:[bytes]},{retryCount:0})});
    const output={...r,planDigest,sourceCommit:config.release.sourceCommit};log(JSON.stringify(output,null,2));return output;
  }finally{controller.abort();process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{process.exitCode=clubPaymentOperatorExitCodeV3(await main());}
  catch{console.error('reward_payment_operator_command_failed');process.exitCode=1;}
}
