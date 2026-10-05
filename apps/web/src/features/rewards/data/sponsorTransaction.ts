import {decodeSponsorExecutionPlan, sponsorAddress, sponsorTxHash, type SponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";
import {sponsorDeploymentData, sponsorFundingData} from "@raceson/rewards-chain/sponsor-v4";
import type {RewardWalletProvider} from "./browserWallet";

export type SponsorTransaction = {plan: SponsorExecutionPlan; action: "deployment" | "funding"; address?: string};
export type SponsorReadiness = {gasCostWei: string | null; balanceWei: string; blocker: "gas_limit" | "balance" | null};
export const MAX_SPONSOR_GAS_COST = 500_000_000_000_000_000n;
// Operator explicitly confirms deployment; this ceiling includes a 20% estimate
// buffer and does not apply to sponsor deposits or change their prize budget.
export const MAX_OPERATOR_DEPLOYMENT_GAS_COST = 3_000_000_000_000_000_000n;
export const sponsorTransactionSender = (input: SponsorTransaction) => input.action === "deployment" ? input.plan.operator : input.plan.funder;
export const sponsorTransactionGasLimit = (action: SponsorTransaction["action"]) => action === "deployment" ? MAX_OPERATOR_DEPLOYMENT_GAS_COST : MAX_SPONSOR_GAS_COST;
const hex = (n: bigint | number) => `0x${BigInt(n).toString(16)}`;
const quantity = (v: unknown): bigint => {
  if (typeof v !== "string" || !/^0x[0-9a-f]+$/i.test(v)) throw Error("invalid_sponsor_wallet_response");
  return BigInt(v);
};
/** Exact V4 transaction capability, never arbitrary calldata/signing. No keys,
 * network switching, RPC discovery, automatic retries or delegated access. */
async function sponsorTransaction(provider: RewardWalletProvider, input: SponsorTransaction, isCurrent: () => boolean, broadcast: boolean): Promise<{readiness: SponsorReadiness; hash?: string}> {
  const plan = decodeSponsorExecutionPlan(input.plan);
  if (input.action !== "deployment" && input.action !== "funding" || input.action === "funding" && !sponsorAddress(input.address)) throw Error("invalid_sponsor_execution");
  const sender = sponsorTransactionSender(input), gasLimit = sponsorTransactionGasLimit(input.action);
  let changed = false;
  const change = () => {changed = true;};
  const events = ["accountsChanged", "chainChanged", "disconnect"];
  const active = () => {if (!isCurrent() || changed) throw Error("sponsor_wallet_changed");};
  const check = async () => {
    active();
    const accounts = await provider.request({method: "eth_accounts"}); active();
    const chain = quantity(await provider.request({method: "eth_chainId"})); active();
    if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || accounts[0].toLowerCase() !== sender || chain !== BigInt(plan.chainId)) throw Error("sponsor_wallet_changed");
  };
  let sending = false;
  events.forEach(e => provider.on(e, change));
  try {
    await check();
    const transaction = {from: sender, chainId: hex(plan.chainId), value: input.action === "funding" ? hex(BigInt(plan.budgetWei)) : "0x0",
      data: input.action === "deployment" ? sponsorDeploymentData(plan) : sponsorFundingData(),
      ...(input.action === "funding" ? {to: input.address!.toLowerCase()} : {})};
    // Some providers reject value-bearing estimates before returning gas when
    // the sender cannot cover the principal. Report that known blocker first.
    const initialBalance = quantity(await provider.request({method: "eth_getBalance", params: [sender, "pending"]}));
    active();
    if (input.action === "funding" && initialBalance <= BigInt(transaction.value)) {
      await check();
      if (broadcast) throw Error("sponsor_insufficient_balance");
      return {readiness: {balanceWei: initialBalance.toString(), gasCostWei: null, blocker: "balance"}};
    }
    const estimate = await provider.request({method: "eth_estimateGas", params: [transaction]});
    // Privy 3.42 returns viem's bigint here; external EIP-1193 wallets return hex.
    const gas = (quantity(typeof estimate === "bigint" ? hex(estimate) : estimate) * 12n + 9n) / 10n;
    active();
    const gasPrice = quantity(await provider.request({method: "eth_gasPrice"}));
    const balance = quantity(await provider.request({method: "eth_getBalance", params: [sender, "pending"]}));
    const gasCost = gas * gasPrice;
    const readiness: SponsorReadiness = {gasCostWei: gasCost.toString(), balanceWei: balance.toString(),
      blocker: gas <= 0n || gas > 30_000_000n || gasPrice <= 0n || gasCost > gasLimit ? "gas_limit"
        : balance < gasCost + BigInt(transaction.value) ? "balance" : null};
    await check();
    if (!broadcast) return {readiness};
    if (readiness.blocker) throw Error(readiness.blocker === "gas_limit" ? "sponsor_gas_limit" : "sponsor_insufficient_balance");
    await check();
    // Once a wallet returns a hash, preserve it even if the session changed during
    // confirmation. Losing a broadcast hash could encourage a duplicate send.
    sending = true;
    const hash = await provider.request({method: "eth_sendTransaction", params: [{...transaction, gas: hex(gas), gasPrice: hex(gasPrice)}]});
    if (!sponsorTxHash(typeof hash === "string" ? hash.toLowerCase() : hash)) throw Error("sponsor_transaction_unknown");
    return {readiness, hash: (hash as string).toLowerCase()};
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === 4001 || code === "ACTION_REJECTED") throw Error("sponsor_wallet_rejected");
    if (error instanceof Error && error.message.startsWith("sponsor_")) throw error;
    // Never label an uncertain broadcast as safe to resend, or expose raw RPC data.
    throw Error(sending ? "sponsor_transaction_unknown" : "sponsor_preflight_failed");
  } finally {events.forEach(e => provider.removeListener(e, change));}
}

/** Read-only estimate using the same sender, calldata and limits as submission. */
export async function checkSponsorTransaction(provider: RewardWalletProvider, input: SponsorTransaction, isCurrent: () => boolean): Promise<SponsorReadiness> {
  return (await sponsorTransaction(provider, input, isCurrent, false)).readiness;
}
export async function sendSponsorTransaction(provider: RewardWalletProvider, input: SponsorTransaction, isCurrent: () => boolean): Promise<string> {
  return (await sponsorTransaction(provider, input, isCurrent, true)).hash!;
}
