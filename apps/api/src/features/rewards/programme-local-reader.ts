import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import type { RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";

/** Fixed server-only READ gateway of the owned local rehearsal runtime.
 * No request/env RPC URL, wallet, test actions or broadcast capability. Selection
 * is confined to the explicit local demo (31337), never public testnet/mainnet. */
const endpoint = "http://127.0.0.1:18546";
const chain = defineChain({ id: 31337, name: "RacesOn local MON simulation", nativeCurrency: { name: "Local MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [endpoint] } } });
const client = createPublicClient({ chain, transport: http(endpoint, { retryCount: 0, timeout: 10000 }), cacheTime: 0 });
export const programmeLocalReader: RewardProgrammeReaderV3 & Pick<PublicClient, "getTransactionCount" | "call" | "getStorageAt"> = Object.freeze({
  getChainId: client.getChainId, getBlock: client.getBlock, getTransaction: client.getTransaction,
  getTransactionReceipt: client.getTransactionReceipt, getCode: client.getCode, readContract: client.readContract, getBalance: client.getBalance,
  getTransactionCount: client.getTransactionCount, call: client.call, getStorageAt: client.getStorageAt,
});
