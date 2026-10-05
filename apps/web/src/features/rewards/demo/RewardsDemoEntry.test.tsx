import { render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountLocaleSynchronizer } from "@/shared/i18n/AccountLocaleSynchronizer";
import RewardsDemoEntry from "./RewardsDemoEntry";

vi.mock("next/dynamic", () => ({ default: () => function DemoFixture() {
  return <><AccountLocaleSynchronizer /><p>Demo application fixture</p></>;
} }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { rewardDemo: { chainId: 31337 } } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ account: { userId: "synthetic-user", locale: "en" } }) }));
afterEach(() => { document.cookie = "raceson_locale=; Path=/; Max-Age=0"; });

describe("demo notice and locale initialization", () => {
  it("renders a consistent server shell, then preserves an explicit Croatian cookie over account defaults", async () => {
    document.cookie = "raceson_locale=hr; Path=/";
    const html = renderToString(<RewardsDemoEntry />);
    expect(html).toContain("Local rewards simulation");
    expect(html).not.toContain("Lokalna simulacija nagrada");
    render(<RewardsDemoEntry />);
    await waitFor(() => expect(screen.getByRole("complementary", { name: "Demo testne mreže" })).toHaveTextContent("Lokalna simulacija nagrada"));
    expect(screen.getByRole("button", { name: "Hrvatski" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Demo application fixture")).toBeVisible();
  });
  it("keeps the separate-login warning visible alongside the independently loaded app", () => {
    render(<RewardsDemoEntry />);
    expect(screen.getByRole("complementary", { name: "Testnet demo" })).toHaveTextContent("not your production password");
    expect(screen.getByText("Demo application fixture")).toBeVisible();
  });
});
