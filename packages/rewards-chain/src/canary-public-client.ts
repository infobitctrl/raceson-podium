import { createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";

/** Pace request STARTS, including parallel observations, not responses. This is
 * process-local (not a distributed/IP-wide quota). All clients below share five
 * private HTTP starts per second. Read-only batches may start ten times/second
 * within the same 40-read and 20-eth_call rolling budgets.
 * No cached successes, endpoint substitution or automatic transaction retries. */
export function createCanaryRpcPacer(): (signal?:AbortSignal,ethCalls?:number,start?:()=>void,logicalReads?:number) => Promise<void> {
  let tail = Promise.resolve(), nextStart = 0, nextPrivateStart = 0;
  const calls:{at:number;count:number;reads:number}[]=[];
  return (signal,ethCalls=1,start,logicalReads) => {
    const verification=logicalReads!==undefined;
    logicalReads??=Math.max(1,ethCalls);
    if(!Number.isInteger(ethCalls)||ethCalls<0||!Number.isInteger(logicalReads)||logicalReads<1||logicalReads>20||ethCalls>logicalReads)return Promise.reject(Error('invalid_rpc_batch'));
    if(signal?.aborted)return Promise.reject(signal.reason);
    const turn = tail.then(async () => {
      signal?.throwIfAborted();
      while (true) {
        const now=performance.now();
        while(calls.length&&calls[0]!.at<=now-1000)calls.shift();
        let wait=Math.max(nextStart,verification?0:nextPrivateStart)-now,used=calls.reduce((sum,call)=>sum+call.count,0),reads=calls.reduce((sum,call)=>sum+call.reads,0);
        for(const call of calls){
          if(used+ethCalls<=20&&reads+logicalReads<=40)break;
          wait=Math.max(wait,call.at+1000-now);used-=call.count;reads-=call.reads;
        }
        if(wait<=0)break;
        await new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},Math.ceil(wait));
          const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(signal?.reason);};
          signal?.addEventListener('abort',cancel,{once:true});
          if(signal?.aborted)cancel();
        });
        signal?.throwIfAborted();
      }
      signal?.throwIfAborted();
      const started=performance.now();nextStart = started + 100;
      if(!verification)nextPrivateStart=started+200;
      calls.push({at:started,count:ethCalls,reads:logicalReads});
      start?.();
    });
    tail = turn.catch(() => {});
    if(!signal)return turn;
    // A timed-out request must leave the caller immediately and must not spend
    // another rate-limit slot when its queued turn eventually arrives.
    return new Promise<void>((resolve,reject)=>{
      const cancelled=()=>reject(signal.reason);
      signal.addEventListener('abort',cancelled,{once:true});
      if(signal.aborted)cancelled();
      turn.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancelled));
    });
  };
}
const pace = createCanaryRpcPacer();
// Start fetch in the granted slot itself. An async request hook can reserve a
// slot, then reach fetch later under load and bunch actual network starts.
function pacedFetch(input:Parameters<typeof fetch>[0],init:Parameters<typeof fetch>[1],ethCalls=1,logicalReads?:number):Promise<Response>{
  return new Promise((resolve,reject)=>{
    void pace(init?.signal??undefined,ethCalls,()=>{resolve(fetch(input,init));},logicalReads).catch(reject);
  });
}
// One public client/queue per process, shared by the V2 and V3 status endpoints.
// No environment discovery, authentication, signing or private provider key.
const transport = http("https://testnet-rpc.monad.xyz", { timeout: 15000, retryCount: 0,fetchFn:pacedFetch });
export const canaryPublicClient = createPublicClient({ chain: monadTestnet, cacheTime: 0, transport });
// Controller and public reward status read-only eth_call getters opt in. Deployless aggregation uses
// viem's local call bytecode, not an external Multicall deployment or a transaction.
// The transport and ordinary five-starts/second pacing remain unchanged.
export const controllerReadBatch = {multicall:{deployless:true,batchSize:4096,wait:0}} as const;
export const controllerPublicClient = createPublicClient({chain:monadTestnet,cacheTime:0,batch:controllerReadBatch,transport});

// Directory verification also reads bytecode, receipts and block headers
// outside eth_call multicalls. Group at most twenty read-only RPCs per
// HTTP request. The shared FIFO permits ten read-only batch starts/second while
// ordinary unbatched work retains five starts/second. Rolling budgets keep
// logical reads at 40/sec and eth_call at 20/sec, including private work.
// Both remain below the endpoint's 50 RPC/sec and 25 eth_call/sec limits:
// https://docs.monad.xyz/developer-essentials/testnet (checked 2026-10-12).
// Preparation/signing/submission retain their original unbatched transport.
export const publicDirectoryRpcBatch = {batchSize:20,wait:0} as const;
function verificationTransport(includeStorage=false){
 return http("https://testnet-rpc.monad.xyz",{timeout:15000,retryCount:0,batch:publicDirectoryRpcBatch,
    methods:{include:['eth_chainId','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getCode','eth_call','eth_getBalance',...(includeStorage?['eth_getStorageAt' as const]:[])]},
    fetchFn:(input,init)=>{
      const body=JSON.parse(init?.body as string),requests=Array.isArray(body)?body:[body];
      return pacedFetch(input,init,requests.filter((item:{method:string})=>item.method==='eth_call').length,requests.length);
    },
  });
}
export const publicDirectoryClient = createPublicClient({chain:monadTestnet,cacheTime:0,batch:controllerReadBatch,transport:verificationTransport()});
// Only receipt recording opts in; preparation, signing and submission keep their
// existing readers. Safe provenance also needs a read-only storage lookup.
export const receiptVerificationClient = createPublicClient({chain:monadTestnet,cacheTime:0,batch:controllerReadBatch,transport:verificationTransport(true)});
