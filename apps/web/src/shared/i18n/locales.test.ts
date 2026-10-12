import { describe, expect, it } from "vitest";
import {
  localeFromAcceptLanguage,
  localeFromCountry,
  normalizeAppLocale,
  resolveDetectedLocale,
} from "@/shared/i18n/locales";
import { translate } from "@/shared/i18n/messages";

describe("application locale resolution", () => {
  it("normalizes supported regional locale values", () => {
    expect(normalizeAppLocale("hr-HR")).toBe("hr");
    expect(normalizeAppLocale("en_GB")).toBe("en");
    expect(normalizeAppLocale("de-DE")).toBeNull();
  });

  it("selects Croatian for Croatia and English for other known locations", () => {
    expect(localeFromCountry("hr")).toBe("hr");
    expect(localeFromCountry("SI")).toBe("en");
    expect(localeFromCountry(null)).toBeNull();
  });

  it("uses quality-weighted browser languages when location is unavailable", () => {
    expect(localeFromAcceptLanguage("en-GB;q=0.7, hr-HR;q=0.9")).toBe("hr");
    expect(localeFromAcceptLanguage("de-DE, en-US;q=0.8")).toBe("en");
  });

  it("gives an available country location precedence over browser language", () => {
    expect(resolveDetectedLocale({ countryCode: "HR", acceptLanguage: "en-US" })).toBe("hr");
    expect(resolveDetectedLocale({ countryCode: "DE", acceptLanguage: "hr-HR" })).toBe("en");
  });
});

describe("translations", () => {
  it("returns Croatian messages and interpolates values", () => {
    expect(translate("hr", "home.upcomingEvents")).toBe("Nadolazeće utrke");
    expect(translate("hr", "workspace.openAccount", { name: "Luka" })).toBe("Luka. Otvori račun");
  });

  it("falls back to the key instead of crashing for an unknown runtime message", () => {
    expect(translate("en", "runtime.missing" as never)).toBe("runtime.missing");
  });
});
