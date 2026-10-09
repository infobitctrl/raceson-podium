import { render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountLocaleSynchronizer } from "@/shared/i18n/AccountLocaleSynchronizer";
import { useI18n } from "@/shared/i18n/I18nContext";
import RewardsDemoEntry from "./RewardsDemoEntry";

const state = vi.hoisted(() => ({ account: null as { userId: string; locale: string } | null }));
vi.mock("next/dynamic", () => ({ default: () => function DemoFixture() {
  const { locale } = useI18n();
  return <><AccountLocaleSynchronizer /><p>Demo application fixture: {locale}</p></>;
} }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ account: state.account }) }));
afterEach(() => {
  document.cookie = "raceson_locale=; Path=/; Max-Age=0";
  document.cookie = "raceson_detected_locale=; Path=/; Max-Age=0";
  state.account = null;
  vi.restoreAllMocks();
});

describe("demo shell and English default", () => {
  it("defaults to English despite Croatian device and previously detected locale", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["hr-HR"]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("hr-HR");
    document.cookie = "raceson_detected_locale=hr; Path=/";
    const html = renderToString(<RewardsDemoEntry />);
    expect(html).toContain("Demo application fixture: <!-- -->en");
    render(<RewardsDemoEntry />);
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
    expect(screen.getByText("Demo application fixture: en")).toBeVisible();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Change language" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Monad testnet|production password/)).not.toBeInTheDocument();
  });
  it("preserves an explicit language choice over account defaults", async () => {
    document.cookie = "raceson_locale=hr; Path=/";
    state.account = { userId: "synthetic-user", locale: "en" };
    render(<RewardsDemoEntry />);
    expect(await screen.findByText("Demo application fixture: hr")).toBeVisible();
  });
  it("retains a signed-in account's saved language preference", async () => {
    state.account = { userId: "synthetic-user", locale: "hr" };
    render(<RewardsDemoEntry />);
    expect(await screen.findByText("Demo application fixture: hr")).toBeVisible();
  });
});
