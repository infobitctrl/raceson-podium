import { describe, expect, it } from "vitest";
import { croatianMessages, englishMessages, translate, type TranslationKey } from "@/shared/i18n/messages";
import { croatianApplicationCopy, croatianApplicationTemplateCopy } from "@/shared/i18n/applicationCopyTranslations";
import { translateApplicationCopyToCroatian } from "@/shared/i18n/documentLocalization";

const placeholders = (value: string) => [...new Set(value.match(/\{\w+\}/g) ?? [])].sort();

describe("Croatian content contract", () => {
  it("keeps every message and interpolation available", () => {
    expect(Object.keys(croatianMessages).sort()).toEqual(Object.keys(englishMessages).sort());
    for (const key of Object.keys(englishMessages) as TranslationKey[]) {
      expect(croatianMessages[key].trim(), key).not.toBe("");
      expect(placeholders(croatianMessages[key]), key).toEqual(placeholders(englishMessages[key]));
    }
    for (const [english, croatian] of Object.entries(croatianApplicationTemplateCopy)) {
      const expected = placeholders(english).filter((placeholder) => {
        // JSX plural suffixes are intentionally omitted from Croatian labels.
        const index = english.indexOf(placeholder);
        return croatian.includes(placeholder) || !/[a-z]$/i.test(english.slice(0, index));
      });
      expect(placeholders(croatian), english).toEqual(expected);
    }
  });

  it("does not mistake Croatian starts for English star ratings", () => {
    for (const text of [
      "Postavi centar utrke, parking, prijave, start, cilj i medicinske lokacije.",
      "Potvrdi natjecatelje, podijeli brojeve i zaključi startnu listu.",
      "Otvori startne valove.", "Broj mjesta i startovi",
    ]) expect(translateApplicationCopyToCroatian(text), text).toBe(text);
    expect(translateApplicationCopyToCroatian("1 star")).toBe("Broj zvjezdica: 1");
    expect(translateApplicationCopyToCroatian("5 stars")).toBe("Broj zvjezdica: 5");
    expect(translateApplicationCopyToCroatian("1 queued punch synced.")).toBe("Poslani prolazi: 1.");
    expect(translateApplicationCopyToCroatian("2 queued punches synced.")).toBe("Poslani prolazi: 2.");
  });

  it("distinguishes received, waitlisted, reported payment and paid", () => {
    expect(translate("hr", "registration.received.accountDescription")).toContain("Prijava je spremljena");
    expect(translate("hr", "registration.toast.waitlisted")).toContain("Mjesto još nije potvrđeno");
    expect(translate("hr", "registration.toast.transferReported")).toContain("kad primi novac");
    expect(translate("hr", "registration.privacyNotice")).toContain("Prijave koje se plaćaju čekaju potvrdu");
    expect(translateApplicationCopyToCroatian("Bib 42 saved on this device and is ready to sync.")).toBe(
      "Startni broj 42 spremljen je na ovom uređaju. Još ga treba poslati u sustav.",
    );
    expect(translate("hr", "results.status.dnf")).toBe("DNF");
  });

  it.each([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 102])("uses count-neutral labels for %i", (count) => {
    expect(translate("hr", "athlete.dashboard.upcomingRegistrations", { count })).toBe(`Nadolazeće prijave: ${count}`);
    expect(translate("hr", "organizer.league.publishBlockers", { count })).toBe(`Potrebne dorade prije objave: ${count}`);
    expect(translateApplicationCopyToCroatian(`${count} reviews`)).toBe(`Recenzije: ${count}`);
    expect(translate("hr", "organizer.event.finishedDescription", { count })).toContain(`Broj utrka: ${count}.`);
  });

  it("avoids mixing formal and informal address in application-owned catalogs", () => {
    const formal = /(?<!\p{L})(?:odaberite|unesite|spremite|prijavite|pregledajte|vaš|vaša|vaše|biste|ćete|ste)(?!\p{L})/iu;
    for (const [key, value] of Object.entries({ ...croatianMessages, ...croatianApplicationCopy, ...croatianApplicationTemplateCopy })) {
      expect(value, key).not.toMatch(formal);
    }
  });

  it("distinguishes a setup step from a league round", () => {
    expect(translate("hr", "organizer.event.stepOf", { step: 6, total: 6 })).toBe("Korak 6 od 6");
    expect(translate("hr", "league.table.stage")).toBe("Kolo");
  });

  it("translates composed public route descriptions sentence by sentence", () => {
    const zlarinOverview = [
      "A good step-up route for regular runners who want variety without extreme exposure.",
      "The route rewards pacing and steady effort more than one big climb.",
      "Open views are visible from several parts of the route.",
      "The route has a coastal feel with open terrain and sea-facing stretches.",
    ].join(" ");

    expect(translateApplicationCopyToCroatian(zlarinOverview)).toBe([
      "Dobar je sljedeći korak za redovite trkače koji žele raznolikost bez izrazito izloženih dionica.",
      "Na ovoj su ruti važniji dobar raspored snage i ujednačen napor nego jedan veliki uspon.",
      "Otvoreni pogledi pružaju se s nekoliko dijelova rute.",
      "Ruta ima obalni ugođaj, otvoren teren i dionice okrenute prema moru.",
    ].join(" "));

    expect(translateApplicationCopyToCroatian(`${zlarinOverview} Prilagođena napomena organizatora.`))
      .toContain("Prilagođena napomena organizatora.");
  });
});
