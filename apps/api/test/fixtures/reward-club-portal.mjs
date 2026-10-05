const id = n => `7a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = n => `0x${n.repeat(64)}`, address = n => `0x${n.repeat(40)}`;
const identity = { userId: id(1), sessionId: id(2) }, config = { chainId: 31337, origin: "http://127.0.0.1:5173" };
export const clubPaymentFixture = (status = "confirmed") => {
  const finalizedBlock = { number: "50", hash: hash("a"), timestamp: "1788854410" };
  return { claim: { intentId: id(10), programmeId: id(3), campaignId: id(4), entitlementId: id(5), scopeKey: id(6),
    clubId: id(7), clubName: "Synthetic trail club", roundNumber: 1, raceName: "Synthetic round one", pot: "race", chainId: 31337, amountWei: "999999999999999999", recipientAddress: address("b"), issuedAt: "1788854400",
    expiresAt: "1788940800", preparedAt: "2026-09-08T08:00:00Z", recipientConsentRecordedAt: "2026-09-08T08:00:01Z",
    operatorApprovalRecordedAt: "2026-09-08T08:00:02Z" },
    chainEntitlementId: hash("c"), authorizationNonce: "0", allocationDigest: hash("d"), status,
    confirmation: status !== "confirmed" ? null : { recordedAt: "2026-09-08T08:00:12Z", observedAt: "2026-09-08T08:00:11Z",
      transactionHash: hash("e"), deployment: { schemaVersion: 1, chainId: 31337, contractAddress: address("f"),
        buildId: "synthetic-verified-ledger", creationCodeHash: hash("1"), runtimeCodeHash: hash("2"), deploymentTransactionHash: hash("3"),
        deploymentNonce: "0", deploymentBlockNumber: "1", deploymentBlockHash: hash("4") },
      payment: { schemaVersion: 1, action: "pay_club", chainId: 31337, contractAddress: address("f"), relayerAddress: address("9"),
        transactionHash: hash("e"), nonce: "1", blockNumber: "50", blockHash: hash("a"), blockTimestamp: "1788854410", logIndex: 0, safeReceivedLogIndex: 1,
        entitlementId: hash("c"), recipient: address("b"), amount: "999999999999999999", pot: "race", authorizationNonce: "0",
        allocationDigest: hash("d"), gasLimit: "500000", gasUsed: "100000", effectiveGasPrice: "100", monadGasLimitFee: "50000000",
        runtimeCodeHash: hash("2"), finalizedBlock },
      observation: { schemaVersion: 1, finalizedBlock: { ...finalizedBlock }, accounting: { state: 3, paused: false,
        accountedFunding: "999999999999999999", treasuryReturned: "0", budgets: ["999999999999999999", "0"],
        allocated: ["999999999999999999", "0"], paid: ["999999999999999999", "0"], nativeBalance: "0", entitlementCount: "1",
        uploadDigest: hash("5"), snapshotDigest: hash("6"), allocationDigest: hash("d"), activationNotBefore: "1788854300",
        claimDeadline: "1820390300", pausedAt: "0" } } } };
};
export { id as clubPortalId, identity as clubPortalIdentity, config as clubPortalConfig };
