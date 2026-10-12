import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountLocaleSynchronizer } from "@/shared/i18n/AccountLocaleSynchronizer";
import { useI18n } from "@/shared/i18n/I18nContext";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import {
  DETECTED_LOCALE_COOKIE_NAME,
  LOCALE_COOKIE_NAME,
} from "@/shared/i18n/locales";

const authMocks = vi.hoisted(() => ({
  account: {
    userId: "athlete-1",
    locale: "hr",
  } as { userId: string; locale: string } | null,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ account: authMocks.account }),
}));

function LocaleProbe() {
  const { locale, source } = useI18n();
  return <output>{`${locale}:${source}`}</output>;
}

function clearLocaleCookies() {
  document.cookie = `${LOCALE_COOKIE_NAME}=; Path=/; Max-Age=0`;
  document.cookie = `${DETECTED_LOCALE_COOKIE_NAME}=; Path=/; Max-Age=0`;
}

describe("AccountLocaleSynchronizer", () => {
  beforeEach(() => {
    clearLocaleCookies();
    authMocks.account = { userId: "athlete-1", locale: "hr" };
  });

  afterEach(() => {
    clearLocaleCookies();
    document.documentElement.lang = "en";
  });

  it("preserves an explicit browser language instead of restoring the account locale", async () => {
    document.cookie = `${LOCALE_COOKIE_NAME}=en; Path=/`;

    render(
      <I18nProvider>
        <AccountLocaleSynchronizer />
        <LocaleProbe />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText("en:explicit")).toBeInTheDocument());
    expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=en`);
  });

  it("uses the account locale when the browser only has a detected language", async () => {
    document.cookie = `${DETECTED_LOCALE_COOKIE_NAME}=en; Path=/`;

    render(
      <I18nProvider>
        <AccountLocaleSynchronizer />
        <LocaleProbe />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText("hr:profile")).toBeInTheDocument());
    expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=hr`);
  });
});
