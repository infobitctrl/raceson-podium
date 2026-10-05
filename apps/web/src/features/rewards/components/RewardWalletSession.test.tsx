import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import RewardWalletSession from "./RewardWalletSession";
import RewardEmbeddedWalletControls from "./RewardEmbeddedWalletControls";
import { RewardWalletRuntimeContext, type RewardWalletRuntimeProps } from "./RewardEmbeddedWalletContext";

const mocks = vi.hoisted(() => ({ auth: { user: { id: "first" }, account: { userId: "first", hasAthleteAccess: true },
  session: { id: "session-one" }, isLoading: false }, runtime: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { rewardDemo: { mode: "local-testnet", chainId: 10143,
  origin: window.location.origin, supabaseUrl: "http://127.0.0.1:55321" } } }));
function Runtime(props: RewardWalletRuntimeProps) {
  mocks.runtime(props);
  useEffect(() => props.onState(props.sessionKey, { status: "ready", wallet: null, address: "synthetic-address" }), [props.sessionKey, props.onState]);
  return null;
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth.user = { id: "first" }; mocks.auth.account = { userId: "first", hasAthleteAccess: true };
  mocks.auth.session = { id: "session-one" }; });
function view(load: () => Promise<{ default: typeof Runtime }>, appId: string | undefined = "c".repeat(25)) {
  return <I18nProvider initialLocale="en"><RewardWalletRuntimeContext.Provider value={{ appId, load }}>
    <RewardWalletSession><input aria-label="Existing unsaved form" defaultValue="" /><RewardEmbeddedWalletControls /></RewardWalletSession>
  </RewardWalletRuntimeContext.Provider></I18nProvider>;
}
describe("lazy demo wallet session", () => {
  it("does not load an unconfigured provider", () => {
    const load = vi.fn(); render(view(load, "")); expect(load).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Connect with Privy" })).not.toBeInTheDocument();
  });
  it("allows a sponsor without athlete access to opt in", async () => {
    mocks.auth.account.hasAthleteAccess = false;
    const load = vi.fn(async () => ({ default: Runtime })); render(view(load));
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Connect with Privy" }));
    await screen.findByText("synthetic-address"); expect(load).toHaveBeenCalledOnce();
  });
  it("preserves an open form while loading the provider only after explicit opt-in", async () => {
    const load = vi.fn(async () => ({ default: Runtime })); render(view(load)); expect(load).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "unsaved organizer input" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect with Privy" }));
    await screen.findByText("synthetic-address"); expect(load).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox")).toHaveValue("unsaved organizer input");
  });
  it("does not reuse one user's opt-in or address for the next user", async () => {
    const load = vi.fn(async () => ({ default: Runtime })), page = render(view(load));
    fireEvent.click(screen.getByRole("button", { name: "Connect with Privy" })); await screen.findByText("synthetic-address");
    mocks.auth.user = { id: "second" }; mocks.auth.account = { userId: "second", hasAthleteAccess: true }; mocks.auth.session = { id: "session-two" };
    page.rerender(view(load)); expect(screen.queryByText("synthetic-address")).not.toBeInTheDocument();
    expect(mocks.runtime.mock.lastCall?.[0]).toMatchObject({ walletUserId: null });
    expect(screen.getByRole("button", { name: "Connect with Privy" })).toBeVisible();
    await act(async () => {}); expect(load).toHaveBeenCalledOnce();
  });
});
