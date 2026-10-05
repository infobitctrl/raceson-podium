import {resultDisplaySchema} from "./resultDisplay";
import {z} from "zod";
import {decodeSponsorExecutionRecord} from "@raceson/domain/rewards/sponsor-execution";
import {decodeSponsorExecutionView} from "./sponsorExecutionCodec";
import {decodeSponsorLifecycleView} from "./sponsorLifecycleCodec";

export type ControllerSession={subject:string;wallet:string;chainId:10143;creation?:{configured:boolean;address:string|null;balanceWei:string|null;setup?:{factory:string;signerId:string;policyId:string}}};
export type ControllerRequest=(path:string,body?:unknown)=>Promise<unknown>;
export function createControllerRequest(getToken:()=>Promise<string|null>,current:()=>boolean,selectedWallet?:string):ControllerRequest {
  return async(path,body)=>{
    if(!/^\/(access|session|campaigns|transactions)(\/[a-z0-9/-]+)?$/.test(path)||!current())throw Error("controller_session_changed");
    // Bound token lookup, transport and response parsing. Aborting the browser
    // request does not cancel server work: signed submissions remain recoverable.
    const signedSubmission=path==='/transactions'&&typeof body==='object'&&body!==null&&'action' in body&&body.action==='submit';
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const task=async()=>{
    const token=await getToken();if(abort.signal.aborted)throw Error('controller_request_timeout');
    if(!token||!current())throw Error("controller_session_changed");
    const response=await fetch(`/api/v1/rewards/control${path}`,{method:body?"POST":"GET",cache:"no-store",credentials:"omit",signal:abort.signal,
      headers:{Authorization:`Bearer ${token}`,...(selectedWallet?{"X-Podium-Controller-Wallet":selectedWallet}:{}),...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const value=await response.json();if(!current())throw Error("controller_session_changed");
    if(!response.ok)throw Error(value?.error?.code??"controller_unavailable");
    return value.data;
    };
    try{return await Promise.race([task(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
      reject(Error(signedSubmission?'controller_submission_unknown':'controller_request_timeout'));abort.abort();
    },signedSubmission?90_000:45_000);})]);}
    finally{clearTimeout(timer);}
  };
}
export const decodeControllerSession=(v:unknown)=>z.object({subject:z.string().startsWith("did:privy:"),wallet:z.string().regex(/^0x[0-9a-f]{40}$/),chainId:z.literal(10143),creation:z.object({configured:z.boolean(),address:z.string().regex(/^0x[0-9a-f]{40}$/).nullable(),balanceWei:z.string().regex(/^\d+$/).nullable(),setup:z.object({factory:z.string().regex(/^0x[0-9a-f]{40}$/),signerId:z.string(),policyId:z.string()}).strict().optional()}).strict().optional()}).strict().parse(v) as ControllerSession;
export function decodeControllerCampaigns(value:unknown){
  return z.array(z.object({setupId:z.string().uuid(),name:z.string(),execution:z.unknown(),pots:z.array(z.object({approvalId:z.string().uuid(),slot:z.number().int().min(0).max(5),ready:z.boolean()}))})).max(100).parse(value).map(c=>{
    const execution=decodeSponsorExecutionRecord(c.execution);if(!execution||execution.plan.chainId!==10143)throw Error("invalid_controller_campaign");return{...c,execution};
  });
}
export type ControllerCampaign=ReturnType<typeof decodeControllerCampaigns>[number];
export const decodeControllerExecution=(v:unknown)=>decodeSponsorExecutionView(v,10143);
export function decodeControllerAllocation(v:unknown){
  const life=decodeSponsorLifecycleView(v);
  const {observedBlock}=z.object({observedBlock:z.object({number:z.string().regex(/^\d+$/),hash:z.string().regex(/^0x[0-9a-f]{64}$/),timestamp:z.string().regex(/^\d+$/)}).optional()}).parse(v);
  const review=z.object({review:z.object({results:resultDisplaySchema.optional(),budgetWei:z.string().regex(/^\d+$/),allocatedWei:z.string().regex(/^\d+$/),retainedWei:z.string().regex(/^\d+$/),recipientCount:z.number().int().min(0),documentHash:z.string().regex(/^[0-9a-f]{64}$/),groups:z.array(z.object({id:z.string(),name:z.string(),amountWei:z.string().regex(/^\d+$/),recipientCount:z.number().int().min(0)}))})}).parse(v).review;
  if(life.transaction&&life.transaction.chainId!==10143)throw Error("invalid_controller_campaign");
  if(life.pot&&BigInt(life.pot.paidWei)>BigInt(life.pot.allocatedWei))throw Error('invalid_controller_campaign');
  return{...life,review,observedBlock};
}
export type ControllerAllocation=ReturnType<typeof decodeControllerAllocation>;
