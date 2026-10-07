import { createContext, useContext, useEffect, useState, type ComponentType } from "react";
import type { RewardPrivyConfiguration } from "../model/privyConfiguration";
import { discoverRewardWallets, type DetectedRewardWallet } from "../data/browserWallet";

export type RewardEmbeddedState = {
  status: "unconfigured" | "off" | "loading" | "ready" | "error";
  reviewerConnected?: boolean;
  errorReason?: "initialization_timeout";
  wallet: DetectedRewardWallet | null;
  address?: string;
  enable?: () => void;
  create?: () => Promise<void>;
};
export type RewardWalletRuntimeProps = { configuration: RewardPrivyConfiguration; sessionKey: string; walletUserId: string | null;
  onState: (sessionKey: string, state: RewardEmbeddedState) => void };
export type RewardWalletRuntimeLoader = () => Promise<{ default: ComponentType<RewardWalletRuntimeProps> }>;

// Only the independent demo composition root supplies a provider implementation.
// Normal portal builds have no SDK import, provider config or provider loader.
export const RewardWalletRuntimeContext = createContext<{ appId?: string; load: RewardWalletRuntimeLoader } | null>(null);
export const RewardEmbeddedWalletContext = createContext<RewardEmbeddedState>({ status: "unconfigured", wallet: null });
export const useRewardEmbeddedWallet = () => useContext(RewardEmbeddedWalletContext);

export function useRewardWallets(enabled = true) {
  const embedded = useRewardEmbeddedWallet();
  const [external, setExternal] = useState<DetectedRewardWallet[]>([]);
  useEffect(() => enabled ? discoverRewardWallets(window, setExternal) : undefined, [enabled]);
  if (!enabled) return [];
  return embedded.status === "ready" && embedded.wallet ? [embedded.wallet, ...external] : external;
}
