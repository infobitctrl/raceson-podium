import type {RewardWalletProvider} from "./browserWallet";

/** Display-only funds for the currently connected account. No preflight,
 * permission, signature, transaction or network-switch request. */
export async function readSponsorWalletBalance(provider: RewardWalletProvider, address: string, chainId: number, isCurrent: () => boolean): Promise<string> {
  if (!/^0x[0-9a-f]{40}$/i.test(address) || ![10143, 31337].includes(chainId)) throw Error("sponsor_wallet_changed");
  let changed = false, finished = false;
  const change = () => {changed = true;};
  const events = ["accountsChanged", "chainChanged", "disconnect"];
  const active = () => {if (finished || changed || !isCurrent()) throw Error("sponsor_wallet_changed");};
  const check = async () => {
    active();
    const accounts = await provider.request({method: "eth_accounts"}); active();
    const chain = await provider.request({method: "eth_chainId"}); active();
    if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || accounts[0].toLowerCase() !== address.toLowerCase()
      || typeof chain !== "string" || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== BigInt(chainId)) throw Error("sponsor_wallet_changed");
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  events.forEach(event => provider.on(event, change));
  try {
    const read = async () => {
      await check();
      const balance = await provider.request({method: "eth_getBalance", params: [address.toLowerCase(), "latest"]}); active();
      if (typeof balance !== "string" || !/^0x[0-9a-f]+$/i.test(balance)) throw Error("invalid_sponsor_wallet_response");
      await check();
      return BigInt(balance).toString();
    };
    return await Promise.race([read(), new Promise<never>((_, reject) => {timer = setTimeout(() => reject(Error("sponsor_balance_unavailable")), 15000);})]);
  } finally {
    finished = true;
    if (timer) clearTimeout(timer);
    events.forEach(event => provider.removeListener(event, change));
  }
}
