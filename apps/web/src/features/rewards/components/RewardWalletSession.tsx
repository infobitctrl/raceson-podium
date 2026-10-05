import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { publicEnv } from "@/lib/public-env";
import { useAuth } from "@/lib/auth";
import { rewardPrivyConfiguration } from "../model/privyConfiguration";
import { useRewardSessionEpoch } from "../model/useRewardSessionEpoch";
import { RewardEmbeddedWalletContext, RewardWalletRuntimeContext, type RewardEmbeddedState, type RewardWalletRuntimeProps } from "./RewardEmbeddedWalletContext";

/** Mounts the SDK only after explicit reward-wallet opt-in, then keeps its Auth
 * synchronizer alive across demo routes and logout. Never replaces app login. */
export default function RewardWalletSession({ children }: { children: ReactNode }) {
  const runtime = useContext(RewardWalletRuntimeContext);
  const { user, account, session, isLoading } = useAuth();
  const [Runtime, setRuntime] = useState<ComponentType<RewardWalletRuntimeProps> | null>(null);
  const [status, setStatus] = useState<"off" | "loading" | "error">("off");
  const [walletUserId, setWalletUserId] = useState<string | null>(null);
  const busy = useRef(false);
  const sessionKey = useRewardSessionEpoch(session);
  const [providerState, setProviderState] = useState<{ key: string; value: RewardEmbeddedState } | null>(null);
  const onState = useCallback((key: string, value: RewardEmbeddedState) => setProviderState({ key, value }), []);
  const actualOrigin = window.location.origin;
  const configuration = useMemo(() => rewardPrivyConfiguration(runtime?.appId, publicEnv.rewardDemo, actualOrigin), [runtime?.appId, actualOrigin]);
  useEffect(() => { if (isLoading || !user || account?.userId !== user.id || walletUserId !== user.id) setWalletUserId(null); },
    [isLoading, user, account?.userId, walletUserId]);
  async function enable() {
    if (busy.current || !configuration || !runtime || isLoading || !user || account?.userId !== user.id) return;
    setWalletUserId(user.id);
    if (Runtime) return;
    busy.current = true; setStatus("loading");
    try { const module = await runtime.load(); setRuntime(() => module.default); }
    catch { setStatus("error"); }
    finally { busy.current = false; }
  }
  const signedIn = !isLoading && !!user && account?.userId === user.id;
  const value: RewardEmbeddedState = Runtime ? !signedIn || walletUserId !== user?.id ? { status: "off", wallet: null, enable }
    : providerState?.key === sessionKey ? providerState.value : { status: "loading", wallet: null }
    : { status: configuration ? status : "unconfigured", wallet: null, enable };
  return <RewardEmbeddedWalletContext.Provider value={value}>
    {children}
    {Runtime && configuration ? <Runtime configuration={configuration} sessionKey={sessionKey} walletUserId={walletUserId} onState={onState} /> : null}
  </RewardEmbeddedWalletContext.Provider>;
}
