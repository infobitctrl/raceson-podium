import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import WalletDiagnostic from "./WalletDiagnostic";
import WalletDiagnosticPage from "../app/wallet-diagnostic/page";

const sdk = vi.hoisted(() => ({ provider: vi.fn(), ready: false, walletsReady: false, authenticated: false }));
vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: (props: { children: React.ReactNode }) => { sdk.provider(props); return props.children; },
  usePrivy: () => ({ ready: sdk.ready, authenticated: sdk.authenticated }),
  useWallets: () => ({ ready: sdk.walletsReady, wallets: [] }),
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not_found"); } }));
beforeEach(() => { vi.clearAllMocks(); sdk.ready = false; sdk.walletsReady = false; sdk.authenticated = false; });
afterEach(() => vi.unstubAllEnvs());

describe("development-only read-only wallet diagnostic", () => {
  it("does not mount Privy before opt-in and never enables automatic wallet creation", () => {
    render(<WalletDiagnostic />);
    expect(sdk.provider).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start read-only Privy check" }));
    expect(sdk.provider.mock.lastCall?.[0].config.embeddedWallets).toEqual({
      ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" },
    });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Minimal wallet diagnostic")).toHaveTextContent('"walletsReady":false');
  });
  it("distinguishes SDK readiness from wallet readiness without exposing the user or wallet", () => {
    sdk.ready = true;
    const page = render(<WalletDiagnostic />);
    fireEvent.click(screen.getByRole("button", { name: "Start read-only Privy check" }));
    expect(screen.getByLabelText("Minimal wallet diagnostic")).toHaveTextContent('"sdkReady":true');
    expect(screen.getByLabelText("Minimal wallet diagnostic")).toHaveTextContent('"walletsReady":false');
    sdk.walletsReady = true; page.rerender(<WalletDiagnostic />);
    expect(screen.getByLabelText("Minimal wallet diagnostic")).toHaveTextContent('"walletsReady":true');
  });
  it.each([["production", "local-testnet"], ["development", "local"], ["development", "staging"]])(
    "does not expose its route in %s / %s", (nodeMode, portalMode) => {
      vi.stubEnv("NODE_ENV", nodeMode); vi.stubEnv("RACESON_REWARD_PORTAL_MODE", portalMode);
      expect(() => WalletDiagnosticPage()).toThrow("not_found");
    },
  );
  it("allows only the development testnet route", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("RACESON_REWARD_PORTAL_MODE", "local-testnet");
    expect(WalletDiagnosticPage().type).toBe(WalletDiagnostic);
  });
});
