export function rewardExplorerUrl(chainId: number, kind: "address" | "tx" | "block", value: string | null | undefined) {
  if (chainId !== 10143 || typeof value !== "string") return null;
  const valid = kind === "address" ? /^0x[0-9a-fA-F]{40}$/.test(value)
    : kind === "tx" ? /^0x[0-9a-fA-F]{64}$/.test(value) : /^(0|[1-9][0-9]*)$/.test(value);
  return valid ? `https://testnet.monadvision.com/${kind}/${value}` : null;
}
