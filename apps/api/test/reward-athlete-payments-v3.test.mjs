import assert from "node:assert/strict";
import test from "node:test";
import { decodePaymentFeesV3,decodePaymentAttemptV3,paymentLedgerV3,decodePaymentStatusV3 } from "../../../packages/db/dist/rewards/index.js";
import { dispatchAthleteClaimsV3 } from "../dist/routes/rewards/athlete-claims-v3.js";
import { capturePaymentV3 } from "../dist/features/rewards/athlete-payment-v3-service.js";
import { runPaymentJobV3 } from "../dist/features/rewards/athlete-payment-worker-v3.js";
const id=n=>`8f500000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const hash=n=>`0x${n.repeat(64)}`,address=n=>`0x${n.repeat(40)}`;
const actor={userId:id(1),sessionId:id(2)},scope={chainId:31337,uploadId:id(3),destinationId:id(4),entitlementId:hash("a"),claimId:id(5),paymentId:id(6)};
const fees=()=>({gasLimit:"500000",maxFeePerGas:"30000000000",maxPriorityFeePerGas:"0",maxGasCostWei:"15000000000000000"});
const status=()=>({schema:"raceson-athlete-payment-status-v3",chainId:scope.chainId,uploadId:scope.uploadId,destinationId:scope.destinationId,
  entitlementId:scope.entitlementId,claimId:scope.claimId,recipientAddress:address("b"),amountWei:"1000000000000000001",paymentId:id(6),state:"confirmed",
  transactionHash:hash("c"),confirmed:true,blockNumber:"100",blockHash:hash("d"),readinessHeld:false});
test("V3 payment fees use exact integers and enforce an explicit worst-case gas budget",()=>{
  assert.deepEqual(decodePaymentFeesV3(fees()),{gasLimit:500000n,maxFeePerGas:30000000000n,maxPriorityFeePerGas:0n,maxGasCostWei:15000000000000000n});
  for(const patch of [{gasLimit:"0"},{gasLimit:"30000001"},{gasLimit:500000},{gasLimit:"0500000"},{maxFeePerGas:"0"},
    {maxPriorityFeePerGas:"30000000001"},{maxGasCostWei:"14999999999999999"},{privateKey:"not-allowed"}])assert.throws(()=>decodePaymentFeesV3({...fees(),...patch}));
});
test("V3 signed-attempt decoder rejects ambiguous versions, chains, fields and unsafe nonces",()=>{
  const value={protocolVersion:3,chainId:31337,contractAddress:address("b"),relayerAddress:address("c"),nonce:"0",transactionHash:hash("d"),
    calldataHash:hash("e"),signedTransaction:"0x0201",gasLimit:"500000",maxFeePerGas:"30000000000",maxPriorityFeePerGas:"0",operatorDigest:hash("f"),recipientDigest:hash("1")};
  assert.equal(decodePaymentAttemptV3(value).nonce,0n);
  for(const patch of [{protocolVersion:2},{chainId:143},{nonce:"9007199254740992"},{nonce:0},{signedTransaction:"0x01"},
    {signedTransaction:"0x02"+"aa".repeat(2049)},{transactionHash:hash("0")},{relayerAddress:address("0")},{gasLimit:"0"},{secret:"x"}])
    assert.throws(()=>decodePaymentAttemptV3({...value,...patch}));
});
test("V3 payment scope captures actual actor and IDs before awaits, never accepts mainnet",()=>{
  const a={...actor},s={...scope},captured=capturePaymentV3(a,s);a.userId=id(9);s.paymentId=id(8);
  assert.deepEqual(captured,{actor,scope});
  for(const patch of [{chainId:143},{paymentId:"bad"},{entitlementId:hash("A")}])assert.throws(()=>capturePaymentV3(actor,{...scope,...patch}));
});
test("private V3 payment RPC captures scope, refuses non-lease nulls and redacts provider failures",async()=>{
  const calls=[];const rpc=async(name,args)=>{calls.push({name,args});return{data:null,error:{message:"sensitive SQL or provider credentials"}};};
  await assert.rejects(paymentLedgerV3(actor,scope,undefined,rpc),e=>e.code==="reward_ledger_unavailable"&&!JSON.stringify(e).includes("sensitive SQL"));
  assert.equal(calls[0].name,"service_read_reward_athlete_payment_v3");assert.equal(calls[0].args.p_actor_user_id,actor.userId);
  assert.equal(calls[0].args.p_payment_id,scope.paymentId);
  await assert.rejects(paymentLedgerV3(actor,scope,undefined,async()=>({data:null,error:null})),{code:"invalid_reward_payment_v3"});
  assert.equal(await paymentLedgerV3(actor,scope,{action:"lease",payload:{}},async()=>({data:null,error:null})),null);
  await assert.rejects(paymentLedgerV3(actor,{...scope,chainId:143},undefined,rpc),{code:"invalid_reward_payment_v3"});assert.equal(calls.length,1);
});
test("cancelled V3 worker never loads private proofs, contacts a provider or broadcasts",async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  const unexpected=()=>{calls++;throw Error("must not execute");};
  assert.deepEqual(await runPaymentJobV3(actor,{...scope,jobId:id(7),workerId:id(8)},{chainId:31337,origin:"http://127.0.0.1:3101",
    signal:controller.signal,rpc:unexpected,reader:new Proxy({},{get:()=>unexpected}),broadcast:unexpected}),{jobId:id(7),outcome:"cancelled"});
  assert.equal(calls,0);
});
test("payment status rejects scope substitution, false confirmations, lossy wei and private fields",()=>{
  assert.deepEqual(decodePaymentStatusV3(status(),scope),status());
  for(const change of [v=>v.uploadId=id(9),v=>v.chainId=143,v=>v.amountWei=1,v=>v.confirmed=false,v=>v.blockNumber=null,
    v=>v.blockHash=hash("0"),v=>v.paymentId=null,v=>v.transactionHash=null,v=>v.state="submitted",v=>v.readinessHeld=null,
    v=>v.signature="0x",v=>v.leaseToken=id(8),v=>v.signedTransaction="0x0201"]){
    const v=status();change(v);assert.throws(()=>decodePaymentStatusV3(v,scope));
  }
  assert.equal(decodePaymentStatusV3({...status(),readinessHeld:true},scope).confirmed,true);
});
test("private payment HTTP status derives recipient/operator role from the route and never needs a chain provider",async()=>{
  const path=`/api/v1/athlete/rewards/uploads/${scope.uploadId}/destinations/${scope.destinationId}/awards/${scope.entitlementId}/claims/${scope.claimId}/payment`;
  const request=async(path,options={})=>{let auth=0;const calls=[],r={headers:{}};
    const handled=await dispatchAthleteClaimsV3({method:options.method??"GET"},r,new URL(path,"http://127.0.0.1:3101"),{
      config:()=>options.disabled?null:{chainId:31337,origin:"http://127.0.0.1:3101"},requireIdentity:async()=>{auth++;if(options.authError)throw Error(options.authError);return actor;},
      readJsonBody:async()=>{throw Error("status must not read a request body");},applyPrivateSessionHeaders:r=>{r.headers["Cache-Control"]="private, no-store";},
      rpc:async(name,args)=>{calls.push({name,args});return options.error?{data:null,error:{message:options.error}}:{data:status(),error:null};},
      sendSuccess:(r,data)=>{r.status=200;r.data=data;},sendError:(r,code,error)=>{r.status=code;r.data={error};},
    });return{...r,handled,calls,auth};};
  const recipient=await request(path);assert.equal(recipient.status,200);assert.deepEqual(recipient.data,status());
  assert.match(recipient.headers["Cache-Control"],/no-store/);assert.equal(recipient.calls[0].name,"service_read_reward_payment_status_v3");
  assert.equal(recipient.calls[0].args.p_role,"recipient");assert.equal(recipient.calls[0].args.p_actor_user_id,actor.userId);
  assert.equal((await request(path.replace("athlete","organizer"))).calls[0].args.p_role,"operator");
  const disabled=await request(path,{disabled:true});assert.equal(disabled.handled,false);assert.equal(disabled.auth,0);
  assert.equal((await request(path,{method:"POST"})).handled,false);
  assert.equal((await request(path+"?role=operator")).status,400);
  for(const [options,code] of [[{authError:"Unauthorized"},401],[{authError:"Untrusted browser origin"},403],
    [{error:"reward_readiness_scope_required"},404],[{error:"reward_account_session_required"},401],[{error:"secret SQL"},503]]){
    const r=await request(path,options);assert.equal(r.status,code);assert.doesNotMatch(JSON.stringify(r.data),/secret SQL/);
  }
});
