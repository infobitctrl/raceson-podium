"use client";

import RewardsDemoEntry from "@/features/rewards/demo/RewardsDemoEntry";
import { RewardWalletRuntimeContext } from "@/features/rewards/components/RewardEmbeddedWalletContext";
import { OperationalWalletRuntimeContext } from "@/features/rewards/components/OperationalWalletRuntime";

const runtime = {
  appId: process.env.NEXT_PUBLIC_RACESON_REWARD_PRIVY_APP_ID,
  load: () => import("./PrivyRewardRuntime"),
};
const loadOperationalWallet=()=>import('./PrivyOperationalWallet');

export default function DemoWalletEntry() {
  return <OperationalWalletRuntimeContext.Provider value={loadOperationalWallet}><RewardWalletRuntimeContext.Provider value={runtime}><RewardsDemoEntry /></RewardWalletRuntimeContext.Provider></OperationalWalletRuntimeContext.Provider>;
}
