export function rewardExplorerUrl(chainId: number, kind: "address" | "tx" | "block", value: string | null | undefined) {
  if (chainId !== 10143 || typeof value !== "string") return null;
  const valid = kind === "address" ? /^0x[0-9a-fA-F]{40}$/.test(value)
    : kind === "tx" ? /^0x[0-9a-fA-F]{64}$/.test(value) : /^(0|[1-9][0-9]*)$/.test(value);
  return valid ? `https://testnet.monadvision.com/${kind}/${value}` : null;
}

/** Paid recipients and registered unpaid destinations retain distinct meanings. */
export function publicRewardWalletUrl(chainId: number, reward: {status?: string; recipientAddress?: string; registeredAddress?: string}) {
  const address=reward.status==='claimed'?reward.recipientAddress:reward.status==='unclaimed'?reward.registeredAddress:undefined;
  if (!address || /^0x0{40}$/i.test(address)) return null;
  const addressUrl = rewardExplorerUrl(chainId, 'address', address);
  return addressUrl ? `${addressUrl}?tab=Internal+Transaction` : null;
}
