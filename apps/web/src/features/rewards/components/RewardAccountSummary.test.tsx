import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import RewardAccountSummary from "./RewardAccountSummary";
import { allocationTotal } from "../model/accountSummary";
import { consentV3Fixture } from "../model/athleteConsentV3Fixtures.test-helper";

describe("reward account totals", () => {
  it("deduplicates entitlements and preserves integer wei without counting attempts", () => {
    const award = { chainId: 31337 as const, entitlementId: "a", amountWei: "1000000000000000001" };
    expect(allocationTotal([award, award, { ...award, entitlementId: "b" }])).toBe(2000000000000000002n);
    expect(allocationTotal([{ ...award }, { ...award, amountWei: "2" }])).toBeNull();
    expect(allocationTotal([award, { ...award, chainId: 10143 }])).toBeNull();
  });
  it("does not present an unread award page or missing payment evidence as zero", () => {
    render(<I18nProvider initialLocale="en"><RewardAccountSummary awards={[consentV3Fixture().award]} complete={false} confirmedPaid={null}
      loading={false} hasMore onMore={() => {}} /></I18nProvider>);
    expect(screen.getByText("Not yet verified")).toBeVisible();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show more allocations" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /claim/i })).not.toBeInTheDocument();
  });
  it("labels observed payments as a subtotal while other award receipts are unavailable", () => {
    render(<I18nProvider initialLocale="en"><RewardAccountSummary awards={[{ ...consentV3Fixture().award, amountWei: "2000000000000000000" }]}
      complete confirmedPaid={1000000000000000000n} loading={false} hasMore={false} onMore={() => {}} /></I18nProvider>);
    expect(screen.getByText(/At least/)).toBeVisible();
    expect(screen.queryByText("Awaiting payment")).not.toBeInTheDocument();
  });
  it("keeps payment availability separate even when the full amount is unpaid", () => {
    render(<I18nProvider initialLocale="en"><RewardAccountSummary awards={[{ ...consentV3Fixture().award, amountWei: "2000000000000000000" }]}
      complete paymentsComplete confirmedPaid={0n} loading={false} hasMore={false} onMore={() => {}} /></I18nProvider>);
    const summary = screen.getByRole("region", { name: "Reward summary" });
    expect(within(summary).getByText("2")).toBeVisible();
    expect(within(summary).getByText("0")).toBeVisible();
    expect(within(summary).queryByRole("button", { name: /claim/i })).not.toBeInTheDocument();
  });
});
