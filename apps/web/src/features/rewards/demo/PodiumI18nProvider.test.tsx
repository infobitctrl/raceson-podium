import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PodiumI18nProvider } from "./PodiumI18nProvider";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { useI18n } from "@/shared/i18n/I18nContext";
import { AccountLocaleSynchronizer } from "@/shared/i18n/AccountLocaleSynchronizer";
import { LanguageSwitcher } from "@/shared/i18n/LanguageSwitcher";
import { useRouteLocaleChange } from "@/shared/i18n/useRouteLocaleChange";
import { MobileMoreUtilities } from "@/shared/navigation/MobileMoreUtilities";
import { englishMessages, translate } from "@/shared/i18n/messages";
import { translateEnglish } from "@/shared/i18n/translateEnglish";
import { LOCALE_COOKIE_NAME, DETECTED_LOCALE_COOKIE_NAME } from "@/shared/i18n/locales";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ account: { userId: "synthetic", locale: "hr" } }) }));

function Probe() {
  const { locale, t, setLocale, formatNumber, formatDate } = useI18n();
  const changeRouteLocale = useRouteLocaleChange();
  const location = useLocation();
  return <div>
    <output>{locale}:{location.pathname}</output>
    <p>{t("home.upcomingEvents")}</p>
    <p>{t("workspace.openAccount", { name: "Synthetic" })}</p>
    <p>{t("runtime.missing" as never)}</p>
    <p>{formatNumber(1234.5)}</p>
    <p>{formatDate("2026-10-12T12:00:00Z", { month: "long", timeZone: "UTC" })}</p>
    <button onClick={() => setLocale("hr")}>Attempt language change</button>
    <button onClick={() => changeRouteLocale("hr")}>Attempt route change</button>
  </div>;
}

function show(nested = false) {
  return render(<PodiumI18nProvider><MemoryRouter initialEntries={["/en/events"]}>
    <AccountLocaleSynchronizer />
    {nested ? <I18nProvider initialLocale="hr"><Probe /></I18nProvider> : <Probe />}
    <LanguageSwitcher /><MobileMoreUtilities />
  </MemoryRouter></PodiumI18nProvider>);
}

afterEach(() => {
  for (const key of [LOCALE_COOKIE_NAME, DETECTED_LOCALE_COOKIE_NAME]) document.cookie = `${key}=; Path=/; Max-Age=0`;
});

describe("English-only hackathon presentation", () => {
  it("overrides Croatian browser/account choices without rewriting them", () => {
    document.cookie = `${LOCALE_COOKIE_NAME}=hr; Path=/`;
    document.cookie = `${DETECTED_LOCALE_COOKIE_NAME}=hr; Path=/`;
    const before = document.cookie;
    show();
    expect(screen.getByText("en:/en/events")).toBeVisible();
    expect(screen.getByText("Upcoming Races")).toBeVisible();
    expect(document.documentElement.lang).toBe("en");
    expect(document.cookie).toBe(before);
    expect(screen.queryByRole("group", { name: /language/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Language")).not.toBeInTheDocument();
  });

  it("keeps nested compatibility layouts and attempted changes in English", () => {
    show(true);
    fireEvent.click(screen.getByText("Attempt language change"));
    fireEvent.click(screen.getByText("Attempt route change"));
    expect(screen.getByText("en:/en/events")).toBeVisible();
    expect(document.cookie).not.toContain(`${LOCALE_COOKIE_NAME}=`);
    expect(screen.getByText("runtime.missing")).toBeVisible();
    expect(screen.getByText("1,234.5")).toBeVisible();
    expect(screen.getByText("October")).toBeVisible();
  });

  it("preserves every English message and placeholder fallback", () => {
    for (const key of Object.keys(englishMessages) as (keyof typeof englishMessages)[]) {
      expect(translateEnglish(key, { name: "Synthetic", count: 12 })).toBe(translate("en", key, { name: "Synthetic", count: 12 }));
    }
    expect(translateEnglish("workspace.openAccount")).toBe(translate("en", "workspace.openAccount"));
    expect(translateEnglish("runtime.missing" as never)).toBe("runtime.missing");
  });
});
