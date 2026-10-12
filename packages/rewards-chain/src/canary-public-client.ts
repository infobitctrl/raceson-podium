import { createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";

/** Pace request STARTS, including parallel observations, not responses. This is
 * process-local (not a distributed/IP-wide quota). All clients below share five
 * HTTP starts per second; the directory also bounds logical reads per batch.
 * No cached successes, endpoint substitution or automatic transaction retries. */
export function createCanaryRpcPacer(): (signal?:AbortSignal,ethCalls?:number,start?:()=>void) => Promise<void> {
  let tail = Promise.resolve(), nextStart = 0;
  const calls:{at:number;count:number}[]=[];
  return (signal,ethCalls=1,start) => {
    if(!Number.isInteger(ethCalls)||ethCalls<0||ethCalls>8)return Promise.reject(Error('invalid_rpc_batch'));
    if(signal?.aborted)return Promise.reject(signal.reason);
    const turn = tail.then(async () => {
      signal?.throwIfAborted();
      while (true) {
        const now=performance.now();
        while(calls.length&&calls[0]!.at<=now-1000)calls.shift();
        let wait=nextStart-now,used=calls.reduce((sum,call)=>sum+call.count,0);
        for(const call of calls){
          if(used+ethCalls<=20)break;
          wait=Math.max(wait,call.at+1000-now);used-=call.count;
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
      const started=performance.now();nextStart = started + 200;
      if(ethCalls)calls.push({at:started,count:ethCalls});
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
function pacedFetch(input:Parameters<typeof fetch>[0],init:Parameters<typeof fetch>[1],ethCalls=1):Promise<Response>{
  return new Promise((resolve,reject)=>{
    void pace(init?.signal??undefined,ethCalls,()=>{resolve(fetch(input,init));}).catch(reject);
  });
}
// One public client/queue per process, shared by the V2 and V3 status endpoints.
// No environment discovery, authentication, signing or private provider key.
const transport = http("https://testnet-rpc.monad.xyz", { timeout: 15000, retryCount: 0,fetchFn:pacedFetch });
export const canaryPublicClient = createPublicClient({ chain: monadTestnet, cacheTime: 0, transport });
// Controller and public reward status read-only eth_call getters opt in. Deployless aggregation uses
// viem's local call bytecode, not an external Multicall deployment or a transaction.
// The transport and five-starts/second queue remain shared with all canary work.
export const controllerReadBatch = {multicall:{deployless:true,batchSize:4096,wait:0}} as const;
export const controllerPublicClient = createPublicClient({chain:monadTestnet,cacheTime:0,batch:controllerReadBatch,transport});

// Directory verification also reads bytecode, receipts and block headers
// outside eth_call multicalls. Group at most eight read-only RPCs per
// HTTP request, using the same five-starts/second queue (at most 40 RPCs/sec).
// A separate rolling count keeps eth_call at 20/sec, including private work.
// Both remain below the endpoint's 50 RPC/sec and 25 eth_call/sec limits:
// https://docs.monad.xyz/developer-essentials/testnet (checked 2026-10-12).
// Private observers retain their original unbatched transport and ordering.
export const publicDirectoryRpcBatch = {batchSize:8,wait:0} as const;
export const publicDirectoryClient = createPublicClient({chain:monadTestnet,cacheTime:0,batch:controllerReadBatch,
  transport:http("https://testnet-rpc.monad.xyz",{timeout:15000,retryCount:0,batch:publicDirectoryRpcBatch,
    methods:{include:['eth_chainId','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getCode','eth_call','eth_getBalance']},
    fetchFn:(input,init)=>{
      const body=JSON.parse(init?.body as string),requests=Array.isArray(body)?body:[body];
      return pacedFetch(input,init,requests.filter((item:{method:string})=>item.method==='eth_call').length);
    },
  }),
});
