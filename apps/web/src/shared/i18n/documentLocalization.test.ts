import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installCroatianDocumentLocalization as installDocumentLocalization,
  translateApplicationCopyToCroatian,
} from "@/shared/i18n/documentLocalization";
import {
  croatianApplicationCopy,
  croatianApplicationTemplateCopy,
} from "@/shared/i18n/applicationCopyTranslations";

const restorations: Array<() => void> = [];
function installCroatianDocumentLocalization(root: HTMLElement) {
  const restore = installDocumentLocalization(root);
  restorations.push(restore);
  return restore;
}

describe("document localization compatibility", () => {
  it("uses natural Croatian for the organizer's shared race locations", () => {
    expect(translateApplicationCopyToCroatian("Race-Wide Location Cards")).toBe("Zajedničke lokacije utrke");
    expect(translateApplicationCopyToCroatian("No race-wide location cards yet. Add parking, start, finish, registration, weather, or medical points here, or skip this step for now.")).toBe("Još nema zajedničkih lokacija utrke. Ovdje dodaj parkiralište, start, cilj, prijavni pult, meteorološke ili medicinske točke ili zasad preskoči ovaj korak.");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    restorations.splice(0).forEach((restore) => restore());
    document.body.innerHTML = "";
  });

  it("does not interpret names as numeric counts or translate interpolated names", () => {
    for (const name of ["Crazy hill runners", "Trail athletes", "Family members", "Results runners"]) {
      expect(translateApplicationCopyToCroatian(name)).toBe(name);
    }
    expect(translateApplicationCopyToCroatian("New registration received for Results")).toBe("Nova prijava za Results");
    expect(translateApplicationCopyToCroatian("Type Results to confirm")).toBe("Za potvrdu upiši Results");
    expect(translateApplicationCopyToCroatian("4 members")).toBe("Članova: 4");
    expect(translateApplicationCopyToCroatian("12 runners")).toBe("Broj natjecatelja: 12");
    expect(translateApplicationCopyToCroatian("1,234 runners")).toBe("Broj natjecatelja: 1,234");
    expect(translateApplicationCopyToCroatian("This participant is already marked Rejected.")).toBe("Ovaj je sudionik već označen kao Odbijeno.");
  });

  it("reuses repeated translations without regex scans and bounds the cache", () => {
    const exec = vi.spyOn(RegExp.prototype, "exec");
    const probe = "Cache boundary audit athlete";
    translateApplicationCopyToCroatian(probe);
    exec.mockClear();
    translateApplicationCopyToCroatian(probe);
    const repeatCalls = exec.mock.calls.length;
    for (let index = 0; index < 1025; index++) translateApplicationCopyToCroatian(`Cache eviction audit ${index}`);
    exec.mockClear();
    translateApplicationCopyToCroatian(probe);
    const evictedCalls = exec.mock.calls.length;
    exec.mockRestore();
    expect(repeatCalls).toBe(0);
    expect(evictedCalls).toBeGreaterThan(0);
  });

  it("checks exact interface copy before scanning localized templates", () => {
    const exec = vi.spyOn(RegExp.prototype, "exec");
    const result = translateApplicationCopyToCroatian("Draft saved in this browser.");
    const calls = exec.mock.calls.length;
    exec.mockRestore();
    expect(result).toBe("Skica je spremljena u ovom pregledniku.");
    expect(calls).toBeLessThan(10);
  });

  it("covers newly introduced public, organizer, race-day, and error copy", () => {
    expect(translateApplicationCopyToCroatian("Create an event")).toBe("Izradi utrku");
    expect(translateApplicationCopyToCroatian("Sort desk by")).toBe("Sortiraj prijavni stol prema");
    expect(translateApplicationCopyToCroatian("Complete the required fields:")).toBe("Ispuni obvezna polja:");
    expect(translateApplicationCopyToCroatian("Public race service is unavailable")).toBe(
      "Usluga javnih podataka utrke nije dostupna",
    );
  });

  it("uses plain labels stored in the legacy template catalog", () => {
    for (const [english, croatian] of Object.entries(croatianApplicationTemplateCopy)) {
      if (english.includes("{") || english in croatianApplicationCopy) continue;
      expect(translateApplicationCopyToCroatian(english), english).toBe(croatian);
    }
  });

  it("translates textarea instructions without changing authored contents", async () => {
    document.body.innerHTML = '<textarea placeholder="Short Description" aria-label="Short Description">Results</textarea>';
    const textarea = document.querySelector("textarea")!;
    const restore = installCroatianDocumentLocalization(document.body);

    expect(textarea.placeholder).toBe("Kratki opis");
    expect(textarea.getAttribute("aria-label")).toBe("Kratki opis");
    expect(textarea.value).toBe("Results");
    expect(textarea.textContent).toBe("Results");

    textarea.setAttribute("placeholder", "Club Handle");
    textarea.value = "My club description";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(textarea.placeholder).toBe("Oznaka kluba");
    expect(textarea.value).toBe("My club description");

    restore();
    expect(textarea.placeholder).toBe("Club Handle");
    expect(textarea.getAttribute("aria-label")).toBe("Short Description");
    expect(textarea.value).toBe("My club description");
  });

  it("restores removed translated content and can translate it after reinsertion", async () => {
    document.body.innerHTML = '<section><button aria-label="Results">Results</button></section>';
    const section = document.querySelector("section")!;
    const restore = installCroatianDocumentLocalization(document.body);
    section.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(section.textContent).toBe("Results");
    expect(section.querySelector("button")?.getAttribute("aria-label")).toBe("Results");
    document.body.append(section);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(section.textContent).toBe("Rezultati");
    restore();
    expect(section.textContent).toBe("Results");
  });

  it("restores pending removals and keeps newer application text during cleanup", () => {
    document.body.innerHTML = '<section><button>Results</button></section><p>Results</p>';
    const section = document.querySelector("section")!;
    const paragraph = document.querySelector("p")!;
    const restore = installCroatianDocumentLocalization(document.body);
    section.remove();
    paragraph.textContent = "New application content";
    restore();
    expect(section.textContent).toBe("Results");
    expect(paragraph.textContent).toBe("New application content");
  });

  it("prunes protected author content instead of traversing every descendant", () => {
    document.body.innerHTML = `<section data-i18n-skip>${"<p><span>Results</span></p>".repeat(500)}</section><button>Results</button>`;
    const closest = vi.spyOn(Element.prototype, "closest");
    const restore = installCroatianDocumentLocalization(document.body);
    const checks = closest.mock.calls.length;
    closest.mockRestore();
    expect(checks).toBeLessThan(10);
    expect(document.querySelector("section")?.textContent).toBe("Results".repeat(500));
    expect(document.querySelector("button")?.textContent).toBe("Rezultati");
    restore();
  });

  it("coalesces updates, ignores its own writes, and restores the latest source", async () => {
    const source = "Draft restored and autosaving.";
    const translated = translateApplicationCopyToCroatian(source);
    expect(translated).not.toBe(source);
    const restore = installCroatianDocumentLocalization(document.body);
    const button = document.createElement("button");
    button.textContent = source;
    button.setAttribute("aria-label", source);
    const exec = vi.spyOn(RegExp.prototype, "exec");
    document.body.append(button);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const calls = exec.mock.calls.filter(([value]) => value === source || value === translated).length;
    exec.mockRestore();
    expect(calls).toBe(0);
    expect(button.textContent).toBe(translated);
    button.firstChild!.textContent = "Results";
    button.firstChild!.textContent = "Registrations";
    button.setAttribute("aria-label", "Registrations");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(button.textContent).toBe("Prijave");
    restore();
    expect(button.textContent).toBe("Registrations");
    expect(button.getAttribute("aria-label")).toBe("Registrations");
  });

  it("uses the time-display meaning of relative", () => {
    expect(translateApplicationCopyToCroatian("relative")).toBe("relativno");
    expect(translateApplicationCopyToCroatian("Local / relative")).toBe("Lokalno / relativno");
  });

  it("keeps translated nodes stable when moved within the observed page", async () => {
    document.body.innerHTML = '<section><button>Results</button></section><aside></aside>';
    const button = document.querySelector("button")!;
    const restore = installCroatianDocumentLocalization(document.body);
    document.querySelector("aside")!.append(button);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(button.textContent).toBe("Rezultati");
    restore();
    expect(button.textContent).toBe("Results");
  });

  it("does not retain oversized text in the translation cache", () => {
    const source = "Long author content ".repeat(120);
    translateApplicationCopyToCroatian(source);
    const exec = vi.spyOn(RegExp.prototype, "exec");
    translateApplicationCopyToCroatian(source);
    const calls = exec.mock.calls.length;
    exec.mockRestore();
    expect(calls).toBeGreaterThan(0);
  });

  it("uses the shared catalog for exact and interpolated application copy", () => {
    expect(translateApplicationCopyToCroatian("Results")).toBe("Rezultati");
    expect(translateApplicationCopyToCroatian("  12 spots left ")).toBe("  Preostalo mjesta: 12 ");
    expect(translateApplicationCopyToCroatian("Organizer-authored route story")).toBe(
      "Organizer-authored route story",
    );
    expect(translateApplicationCopyToCroatian("New registration received for TEST 2027")).toBe(
      "Nova prijava za TEST 2027",
    );
    expect(translateApplicationCopyToCroatian("4d ago")).toBe("prije 4 d");
    expect(translateApplicationCopyToCroatian("Fetch legacy Strava data")).toBe(
      "Dohvati stare Strava podatke",
    );
    expect(translateApplicationCopyToCroatian("Bib 42 saved on this device and is ready to sync.")).toBe(
      "Startni broj 42 spremljen je na ovom uređaju. Još ga treba poslati u sustav.",
    );
    expect(translateApplicationCopyToCroatian("This participant is already marked Rejected.")).toBe(
      "Ovaj je sudionik već označen kao Odbijeno.",
    );
    expect(translateApplicationCopyToCroatian("8 startera")).toBe("8 startera");
    expect(translateApplicationCopyToCroatian("Attempt #1")).toBe("Pokušaj #1");
    expect(translateApplicationCopyToCroatian("2026 or #4")).toBe("2026. ili #4");
    expect(translateApplicationCopyToCroatian(
      "Temporary sign-in accounts used only by this organization will be disabled and cleaned up automatically. Permanent RacesOn accounts and separate clubs remain unchanged.",
    )).toBe(
      "Privremeni računi koji služe samo ovoj organizaciji automatski će se ugasiti i izbrisati. Stalni RacesOn računi i zasebni klubovi ostaju.",
    );
    expect(translateApplicationCopyToCroatian(
      "Organization deleted; temporary accounts disposed: 1",
    )).toBe("Organizacija je izbrisana. Izbrisani privremeni računi: 1.");
    expect(translateApplicationCopyToCroatian(
      "Platform audit history is preserved, with the deleted organization reference detached.",
    )).toBe(
      "Povijest promjena ostaje sačuvana, ali više neće biti povezana s izbrisanom organizacijom.",
    );
  });

  it("uses concise, natural Croatian for platform administration", () => {
    expect(translateApplicationCopyToCroatian("Platform administration")).toBe("Upravljanje platformom");
    expect(translateApplicationCopyToCroatian(
      "Manage platform data, integrity reviews, access, and organizations from one workspace.",
    )).toBe("Podaci, pristupi i organizacije na jednom mjestu.");
    expect(translateApplicationCopyToCroatian("Save organization")).toBe("Spremi");
    expect(translateApplicationCopyToCroatian("Save access")).toBe("Spremi");
    expect(translateApplicationCopyToCroatian("Transfer organization ownership")).toBe(
      "Promjena vlasnika organizacije",
    );
    expect(translateApplicationCopyToCroatian("Confirm owner change")).toBe("Potvrdi promjenu");
    expect(translateApplicationCopyToCroatian("Suspended")).toBe("Pauzirano");
    expect(translateApplicationCopyToCroatian("2 of 7 organizations")).toBe("2 od 7 organizacija");
    expect(translateApplicationCopyToCroatian("4 members")).toBe("Članova: 4");
    expect(translateApplicationCopyToCroatian("Results: 12")).toBe("Rezultata: 12");
    expect(translateApplicationCopyToCroatian("Active members: 6")).toBe("Članova: 6");
    expect(translateApplicationCopyToCroatian("Active editions: 1")).toBe("Aktivnih izdanja: 1");
    expect(translateApplicationCopyToCroatian("Test editions: 2")).toBe("Testnih izdanja: 2");
    expect(translateApplicationCopyToCroatian("Seasons: 3")).toBe("Sezona: 3");
    expect(translateApplicationCopyToCroatian("Choose an active member")).toBe("Odaberi aktivnog člana");
    expect(translateApplicationCopyToCroatian("Explain when this role should be assigned.")).toBe(
      "Ukratko napiši čemu služi ova uloga.",
    );
    expect(translateApplicationCopyToCroatian(
      "Transfer or remove the protected audit log data before deleting this organization.",
    )).toBe("Brisanje blokira: povijest promjena. Najprije ukloni tu vezu.");
    expect(translateApplicationCopyToCroatian(
      "Deletion blocked. Check this route for race/category assignments, league recurrence rules, attempts or athlete activities, reviews or condition reports, and badge definitions.",
    )).toBe(
      "Rutu ne možeš izbrisati. Provjeri utrke i kategorije, pravila ponavljanja lige, pokušaje, aktivnosti, recenzije, prijave stanja i značke.",
    );
    expect(translateApplicationCopyToCroatian("Type Trail Šibenik to confirm")).toBe(
      "Za potvrdu upiši Trail Šibenik",
    );
    expect(translateApplicationCopyToCroatian(
      "Owner One will lose organization access. Their RacesOn account and platform data are not deleted.",
    )).toBe(
      "Owner One više neće imati pristup ovoj organizaciji. RacesOn račun i ostali podaci ostaju.",
    );
  });

  it("preserves hash-prefixed ranking and sequence markers in Croatian", () => {
    const translations = {
      ...croatianApplicationCopy,
      ...croatianApplicationTemplateCopy,
    };

    for (const [english, croatian] of Object.entries(translations)) {
      if (!english.includes("#")) continue;
      expect(croatian, english).toContain("#");
      expect(croatian.match(/#\d+/g) ?? [], english).toEqual(english.match(/#\d+/g) ?? []);
    }
  });

  it.each([
    "R1",
    "R1 · R2",
    "R1 · R2 · R3 · R4",
    "R2 · R10 · R12",
    "R1 · Vrpolje Trail 2026",
  ])("preserves the round identifiers in %s", (label) => {
    expect(translateApplicationCopyToCroatian(label)).toBe(label);
  });

  it("still translates route counts next to stable round identifiers", () => {
    expect(translateApplicationCopyToCroatian("R1 · 2 routes")).toBe("R1 · 2 rute");
    expect(translateApplicationCopyToCroatian("R1 · 2 rute")).toBe("R1 · 2 rute");
  });

  it("keeps registration round lists stable through Croatian localization, updates and English restoration", async () => {
    document.body.innerHTML = `<button>R1 · 2 routes</button><table><thead><tr><th>Rounds</th></tr></thead><tbody><tr><td>R1 · R2 · R3</td></tr></tbody></table>`;
    const rounds = document.querySelector("td")!;
    const restore = installCroatianDocumentLocalization(document.body);
    try {
      expect(document.querySelector("th")?.textContent).toBe("Kola");
      expect(document.querySelector("button")?.textContent).toBe("R1 · 2 rute");
      expect(rounds.textContent).toBe("R1 · R2 · R3");
      rounds.textContent = "R2 · R10 · R12";
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rounds.textContent).toBe("R2 · R10 · R12");
    } finally {
      restore();
    }
    expect(document.querySelector("th")?.textContent).toBe("Rounds");
    expect(document.querySelector("button")?.textContent).toBe("R1 · 2 routes");
    expect(rounds.textContent).toBe("R2 · R10 · R12");
  });

  it("translates text and accessibility attributes and restores English", () => {
    document.body.innerHTML = `
      <button class="rounded-full" aria-label="Results">Results</button>
      <p data-i18n-skip>Results</p>
    `;

    const restore = installCroatianDocumentLocalization(document.body);
    const button = document.querySelector("button")!;
    expect(button.textContent).toBe("Rezultati");
    expect(button.getAttribute("aria-label")).toBe("Rezultati");
    expect(button.getAttribute("data-locale-fit")).toBe("pill");
    expect(document.querySelector("p")?.textContent).toBe("Results");

    restore();
    expect(button.textContent).toBe("Results");
    expect(button.getAttribute("aria-label")).toBe("Results");
    expect(button.hasAttribute("data-locale-fit")).toBe(false);
  });
});
