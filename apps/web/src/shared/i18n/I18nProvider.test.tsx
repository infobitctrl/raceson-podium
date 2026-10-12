import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useI18n } from "@/shared/i18n/I18nContext";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import {
  DETECTED_LOCALE_COOKIE_NAME,
  LOCALE_COOKIE_NAME,
} from "@/shared/i18n/locales";

function LocaleProbe() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div>
      <span>{locale}</span>
      <span>{t("home.upcomingEvents")}</span>
      <button type="button" onClick={() => setLocale("en", { source: "explicit" })}>
        English
      </button>
    </div>
  );
}

function clearLocaleCookies() {
  document.cookie = `${LOCALE_COOKIE_NAME}=; Path=/; Max-Age=0`;
  document.cookie = `${DETECTED_LOCALE_COOKIE_NAME}=; Path=/; Max-Age=0`;
}

describe("I18nProvider", () => {
  afterEach(() => {
    clearLocaleCookies();
    document.documentElement.lang = "en";
  });

  it("loads the location-detected Croatian locale", () => {
    document.cookie = `${DETECTED_LOCALE_COOKIE_NAME}=hr; Path=/`;

    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>,
    );

    expect(screen.getByText("hr")).toBeInTheDocument();
    expect(screen.getByText("Nadolazeće utrke")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("hr");
  });

  it("uses a localized route locale before browser detection", () => {
    document.cookie = `${DETECTED_LOCALE_COOKIE_NAME}=hr; Path=/`;

    render(
      <I18nProvider initialLocale="en">
        <LocaleProbe />
      </I18nProvider>,
    );

    expect(screen.getByText("en")).toBeInTheDocument();
    expect(screen.getByText("Upcoming Races")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("remembers an explicit language selection", async () => {
    document.cookie = `${DETECTED_LOCALE_COOKIE_NAME}=hr; Path=/`;

    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Engleski" }));

    expect(screen.getByText("en")).toBeInTheDocument();
    expect(screen.getByText("Upcoming Races")).toBeInTheDocument();
    expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=en`);
  });
});
