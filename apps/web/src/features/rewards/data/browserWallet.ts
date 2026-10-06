import { confirmWalletProof, prepareWalletChallenge } from "./athleteRewards";
import { RewardPortalError, walletAddress, type WalletChallenge, type WalletProof } from "../model/athleteRewards";

export type RewardWalletProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener: (event: string, callback: (...args: unknown[]) => void) => void;
};
export type DetectedRewardWallet = { id: string; name: string | null; provider: RewardWalletProvider;
  sendClubSafeCreation?: (view: import('./clubSafeCreation').ClubCreationView, isCurrent: () => boolean) => Promise<string>;
  checkSponsorTransaction?: (input: import("./sponsorTransaction").SponsorTransaction, isCurrent: () => boolean) => Promise<import("./sponsorTransaction").SponsorReadiness>;
  sendProgrammeTransaction?: (view: import("./sponsorProgramme").SponsorLifecycle | import("./sponsorProgramme").SponsorClaim | import("./sponsorClubClaims").SponsorClubClaim, isCurrent: () => boolean) => Promise<string>;
  sendSponsorTransaction?: (input: import("./sponsorTransaction").SponsorTransaction, isCurrent: () => boolean) => Promise<string> };
function isProvider(value: unknown): value is RewardWalletProvider {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<RewardWalletProvider>;
  return typeof p.request === "function" && typeof p.on === "function" && typeof p.removeListener === "function";
}

/** EIP-6963 discovery is local to the open reward flow. Treat names as untrusted
 * text; do not render wallet-supplied SVGs, URLs or trust/verification badges. */
export function discoverRewardWallets(target: Window, update: (wallets: DetectedRewardWallet[]) => void) {
  const wallets = new Map<string, DetectedRewardWallet>();
  const legacy = (target as Window & { ethereum?: unknown }).ethereum;
  function publish() {
    update(wallets.size ? [...wallets.values()] : isProvider(legacy) ? [{ id: "browser", name: null, provider: legacy }] : []);
  }
  function announce(event: Event) {
    try {
      const value: unknown = (event as CustomEvent).detail;
      if (!value || typeof value !== "object") return;
      const { info, provider } = value as { info?: unknown; provider?: unknown };
      if (!info || typeof info !== "object" || !isProvider(provider)) return;
      const { uuid, name } = info as { uuid?: unknown; name?: unknown };
      if (typeof uuid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)
        || typeof name !== "string" || name.length < 1 || name.length > 64
        || Array.from(name).some(character => { const code = character.codePointAt(0)!; return code < 32 || (code >= 127 && code <= 159); })
        || /[\u202a-\u202e\u2066-\u2069]/.test(name)
        || wallets.size >= 20 || wallets.has(uuid) || [...wallets.values()].some(wallet => wallet.provider === provider)) return;
      wallets.set(uuid, { id: uuid, name, provider }); publish();
    } catch { /* An invalid extension announcement is not application data. */ }
  }
  target.addEventListener("eip6963:announceProvider", announce);
  publish();
  target.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => target.removeEventListener("eip6963:announceProvider", announce);
}

type WalletDependencies = {
  prepare: typeof prepareWalletChallenge;
  confirm: typeof confirmWalletProof;
};
export type PreparedWalletProof = {
  challenge: WalletChallenge;
  confirm: () => Promise<WalletProof>;
  assertCurrent: () => Promise<void>;
  dispose: () => void;
};

/** Permission and personal_sign only. No transaction, network-add/switch,
 * eth_sign, typed payment consent, delegated spending or key export methods. */
export async function prepareBrowserWalletProof(
  provider: RewardWalletProvider,
  origin: string,
  isCurrent: () => boolean,
  onChanged: () => void,
  signal: AbortSignal,
  dependencies: WalletDependencies = { prepare: prepareWalletChallenge, confirm: confirmWalletProof },
): Promise<PreparedWalletProof> {
  const request = provider.request.bind(provider);
  const demandCurrent = () => { if (signal.aborted || !isCurrent()) throw new RewardPortalError("wallet_changed"); };
  demandCurrent();
  const accounts = await request({ method: "eth_requestAccounts" });
  demandCurrent();
  if (!Array.isArray(accounts) || !walletAddress(accounts[0])) throw new RewardPortalError("wallet_changed");
  const address = accounts[0].toLowerCase();
  let changed = false;
  let disposed = false;
  const change = () => { if (!disposed && !changed) { changed = true; onChanged(); } };
  const accountChange = (value: unknown) => {
    if (!Array.isArray(value) || typeof value[0] !== "string" || value[0].toLowerCase() !== address) change();
  };
  const subscriptions: [string, (...args: unknown[]) => void][] = [
    ["accountsChanged", accountChange], ["chainChanged", change], ["disconnect", change],
  ];
  const attached: typeof subscriptions = [];
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    for (const [event, listener] of attached) { try { provider.removeListener(event, listener); } catch { /* Invalid provider. */ } }
  };
  function active() {
    demandCurrent();
    if (changed || disposed) throw new RewardPortalError("wallet_changed");
  }
  async function checkWallet(chainId: number) {
    active();
    const currentAccounts = await request({ method: "eth_accounts" }); active();
    const currentChain = await request({ method: "eth_chainId" }); active();
    if (!Array.isArray(currentAccounts) || typeof currentAccounts[0] !== "string" || currentAccounts[0].toLowerCase() !== address)
      throw new RewardPortalError("wallet_changed");
    if (typeof currentChain !== "string" || !/^0x[0-9a-f]+$/i.test(currentChain) || BigInt(currentChain) !== BigInt(chainId))
      throw new RewardPortalError(chainId === 31337 ? "wrong_local_network" : "wrong_network");
  }
  try {
    signal.addEventListener("abort", dispose, { once: true });
    for (const [event, listener] of subscriptions) { provider.on(event, listener); attached.push([event, listener]); }
    const idempotencyKey = crypto.randomUUID();
    const challenge = Object.freeze({ ...await dependencies.prepare(address, idempotencyKey) }); active();
    const { validateRewardWalletControlMessage } = await import("@raceson/rewards-chain/wallet-control"); active();
    validateRewardWalletControlMessage(challenge, origin);
    await checkWallet(challenge.chainId);
    let signature: string | null = null;
    let confirming = false;
    return {
      challenge,
      dispose,
      assertCurrent: () => checkWallet(challenge.chainId),
      confirm: async () => {
        active();
        if (confirming) throw new RewardPortalError("request_pending");
        confirming = true;
        try {
          await checkWallet(challenge.chainId);
          if (signature === null) {
            if (Date.now() >= Date.parse(challenge.expiresAt)) throw new RewardPortalError("challenge_expired");
            const messageHex = `0x${Array.from(new TextEncoder().encode(challenge.message), byte => byte.toString(16).padStart(2, "0")).join("")}`;
            const signed = await request({ method: "personal_sign", params: [messageHex, address] }); active();
            if (typeof signed !== "string" || !/^0x[0-9a-f]{130}$/i.test(signed)) throw new RewardPortalError("invalid_response");
            signature = signed;
          }
          await checkWallet(challenge.chainId);
          // Keep an uncertain confirmation's exact signature in memory for an
          // explicit retry. Never persist it in a URL, localStorage or logs.
          const proof = await dependencies.confirm(challenge, signature); active();
          return proof;
        } finally { confirming = false; }
      },
    };
  } catch (error) { dispose(); throw error; }
}
