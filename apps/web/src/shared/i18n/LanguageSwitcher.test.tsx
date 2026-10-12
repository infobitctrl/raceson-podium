import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { LOCALE_COOKIE_NAME } from "@/shared/i18n/locales";
import { LanguageSwitcher } from "@/shared/i18n/LanguageSwitcher";
import { useRouteLocaleChange } from "@/shared/i18n/useRouteLocaleChange";

function clearLocaleCookie() {
  document.cookie = `${LOCALE_COOKIE_NAME}=; Path=/; Max-Age=0`;
}

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

function RouteAwareLanguageSwitcher() {
  const changeLocale = useRouteLocaleChange();
  return <LanguageSwitcher compact onLocaleChange={changeLocale} />;
}

describe("LanguageSwitcher", () => {
  afterEach(() => {
    clearLocaleCookie();
    document.documentElement.lang = "en";
  });

  it("shows both languages in a compact pill and moves the selected state", () => {
    document.cookie = `${LOCALE_COOKIE_NAME}=hr; Path=/`;

    render(
      <MemoryRouter>
        <I18nProvider>
          <LanguageSwitcher compact />
        </I18nProvider>
      </MemoryRouter>,
    );

    const group = screen.getByRole("group", { name: "Promijeni jezik" });
    const croatianButton = within(group).getByRole("button", { name: "Hrvatski" });
    const englishButton = within(group).getByRole("button", { name: "Engleski" });
    expect(croatianButton).toHaveTextContent("HR");
    expect(croatianButton).toHaveAttribute("aria-pressed", "true");
    expect(croatianButton).toHaveClass("bg-primary", "text-primary-foreground");
    expect(englishButton).toHaveTextContent("EN");
    expect(englishButton).toHaveAttribute("aria-pressed", "false");
    expect(group.querySelector("svg")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(englishButton);

    const translatedGroup = screen.getByRole("group", { name: "Change language" });
    expect(within(translatedGroup).getByRole("button", { name: "English" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(within(translatedGroup).getByRole("button", { name: "English" }))
      .toHaveClass("bg-primary", "text-primary-foreground");
    expect(within(translatedGroup).getByRole("button", { name: "Croatian" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=en`);
  });

  it("keeps an explicit localized route aligned with the selected language", () => {
    render(
      <MemoryRouter initialEntries={["/hr/events/demo-race"]}>
        <I18nProvider initialLocale="hr">
          <RouteAwareLanguageSwitcher />
          <CurrentPath />
        </I18nProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Engleski" }));

    expect(screen.getByTestId("current-path")).toHaveTextContent("/en/events/demo-race");
    expect(document.documentElement.lang).toBe("en");
    expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=en`);
  });
});
