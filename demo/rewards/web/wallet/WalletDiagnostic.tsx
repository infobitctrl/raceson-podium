"use client";

import { useState } from "react";
import { PrivyProvider, usePrivy, useWallets, type PrivyClientConfig } from "@privy-io/react-auth";

const config: PrivyClientConfig = {
  embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" } },
};
function Status() {
  const privy = usePrivy();
  const wallets = useWallets();
  return <output aria-label="Minimal wallet diagnostic">{JSON.stringify({
    sdkReady: privy.ready, authenticated: privy.authenticated, walletsReady: wallets.ready,
    connectedCount: wallets.wallets.length, framed: typeof window !== "undefined" && window.top !== window.self,
  })}</output>;
}
export default function WalletDiagnostic() {
  const [enabled, setEnabled] = useState(false);
  return <main className="space-y-4 p-8">
    <h1>Isolated testnet wallet diagnostic</h1>
    <p>No claims, signatures, wallet creation, account changes or payments. No RacesOn Auth adapter.</p>
    <a href="/athlete/rewards">Return to rewards</a>
    {enabled ? <PrivyProvider appId={process.env.NEXT_PUBLIC_RACESON_REWARD_PRIVY_APP_ID!} config={config}>
      <Status />
    </PrivyProvider> : <button onClick={() => setEnabled(true)}>Start read-only Privy check</button>}
  </main>;
}
