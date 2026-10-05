import { createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";

/** Pace request STARTS, including parallel observations, not responses. This is
 * process-local (not a distributed/IP-wide quota). Five per second leaves room
 * for the separate operator and demo process under the observed 15/sec endpoint.
 * No cached successes, endpoint substitution or automatic transaction retries. */
export function createCanaryRpcPacer(): (signal?:AbortSignal) => Promise<void> {
  let tail = Promise.resolve(), nextStart = 0;
  return (signal) => {
    if(signal?.aborted)return Promise.reject(signal.reason);
    const turn = tail.then(async () => {
      signal?.throwIfAborted();
      while (nextStart > performance.now()) {
        await new Promise<void>(resolve => setTimeout(resolve, Math.ceil(nextStart - performance.now())));
      }
      signal?.throwIfAborted();
      nextStart = performance.now() + 200;
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
// One public client/queue per process, shared by the V2 and V3 status endpoints.
// No environment discovery, authentication, signing or private provider key.
const transport = http("https://testnet-rpc.monad.xyz", { timeout: 15000, retryCount: 0,
  onFetchRequest: async request => { await pace(request.signal); request.signal.throwIfAborted(); } });
export const canaryPublicClient = createPublicClient({ chain: monadTestnet, cacheTime: 0, transport });
// Controller and public reward status read-only eth_call getters opt in. Deployless aggregation uses
// viem's local call bytecode, not an external Multicall deployment or a transaction.
// The transport and five-starts/second queue remain shared with all canary work.
export const controllerReadBatch = {multicall:{deployless:true,batchSize:4096,wait:0}} as const;
export const controllerPublicClient = createPublicClient({chain:monadTestnet,cacheTime:0,batch:controllerReadBatch,transport});
