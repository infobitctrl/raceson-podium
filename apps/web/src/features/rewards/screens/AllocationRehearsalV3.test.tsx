import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { translateApplicationCopyToCroatian } from "@/shared/i18n/documentLocalization";
import AllocationRehearsalV3 from "./AllocationRehearsalV3";
function mount(query = "", locale: "en" | "hr" = "en") {
  window.history.replaceState({}, "", "/rewards/rehearsal" + query);
  return render(<I18nProvider initialLocale={locale}><BrowserRouter><AllocationRehearsalV3 /></BrowserRouter></I18nProvider>);
}
describe("anonymous synthetic distribution rehearsal", () => {
  it("shows a separate 100-MON/20-athlete cohort, preserves it through navigation and never signs or pays", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      const v = mount("?cohort=compact_20&stage=five_rounds");
      expect(screen.getByLabelText("Example league")).toHaveValue("compact_20");
      expect(screen.getByRole("note")).toHaveTextContent("100 entries and 97 finishes");
      expect(screen.getByText(/^Suggested preset: 100 test MON → 50 league \+ five 10 race pots/)).toBeVisible();
      expect(screen.getByText(/Synthetic clubs: 4; league places 5–25 remain unused/)).toBeVisible();
      expect(screen.getByText("100 test MON", { selector: "dd" })).toBeVisible();
      expect(screen.getByText("635000 completed metres · 20 synthetic participants")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: /^Round 5 · 10 test MON/ }));
      expect(window.location.search).toContain("cohort=compact_20");
      fireEvent.change(screen.getByLabelText("Inspect reward category"), { target: { value: "8a000000-0000-4000-8000-000000000006" } });
      expect(screen.getByRole("button", { name: "Rehearsal runner #15" })).toBeVisible();
      const query = window.location.search; v.unmount(); mount(query, "hr");
      expect(screen.getByLabelText("Primjer lige")).toHaveValue("compact_20");
      expect(screen.getByRole("note")).toHaveTextContent("100 prijava i 97 završetaka");
      fireEvent.change(screen.getByLabelText("Primjer lige"), { target: { value: "full" } });
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
      expect(screen.getByText("100.000 testnih MON", { selector: "dd" })).toBeVisible();
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it("keeps its label templates from rewriting unrelated synthetic identity labels", () => {
    for (const name of ["Synthetic club owner", "Synthetic athlete Alex", "Synthetic club 1"]) {
      expect(translateApplicationCopyToCroatian(name)).toBe(name);
    }
    expect(translateApplicationCopyToCroatian("Rehearsal club #1")).toBe("Probni klub #1");
  });
  it("starts with four rounds, 60000 retained and zero payable without IO or wallet calls", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      mount(); expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Five-round distribution rehearsal");
      expect(screen.getByText(/Preview only — no wallet or payment required/)).toBeVisible();
      fireEvent.click(screen.getByText(/synthetic calculation · no transactions/i,{selector:"summary"}));
      expect(screen.getByText(/invented test fixtures/)).toBeVisible();
      expect(screen.getAllByRole("definition")).toHaveLength(4);
      expect(screen.getByText("60,000 test MON")).toBeVisible(); expect(screen.getAllByText("0 test MON").length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: /send|approve|pay|connect/i })).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it("switches to five rounds, consumes league ranks and exposes exact distance shares", () => {
    mount(); fireEvent.click(screen.getByRole("button", {name:"Season complete · five rounds"}));
    expect(screen.getByRole("table", { name: "Synthetic rank awards · not payable" })).toBeVisible();
    expect(screen.getByText("6705000 completed metres · 210 synthetic participants")).toBeVisible();
    expect(screen.getByText("≈ 98,561.2648 test MON")).toBeVisible();
    fireEvent.click(screen.getAllByText("Exact amount", { selector: "summary" })[0]);
    expect(screen.getByText("98,561.264822134387351779 test MON")).toBeVisible();
    const table = screen.getByRole("table", { name: "Synthetic rank awards · not payable" });
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Rehearsal runner #2");
    fireEvent.click(within(table).getByRole("button", { name: "Rehearsal runner #2" }));
    expect(within(table).getByText("Scoring total: 400 points")).toBeVisible();
    expect(within(table).getByText("Round 1: 97 · Not counted in standings")).toBeVisible();
    fireEvent.click(screen.getByText("How standings are scored", { selector: "summary" }));
    expect(screen.getByText(/best 4 rounds, at least 2 finishes/)).toBeVisible();
    fireEvent.click(screen.getByText("Inspect distance shares", { selector: "summary" }));
    expect(within(screen.getByRole("table", { name: "Inspect distance shares" })).getAllByRole("row")).toHaveLength(211);
    expect(window.location.search).toContain("stage=five_rounds");
  });
  it("retains the full distance pot after a missing-distance scenario without erasing rank awards", () => {
    mount("?stage=five_rounds"); fireEvent.click(screen.getByText("Test an exception")); fireEvent.click(screen.getByRole("checkbox", {name:"Missing distance data"}));
    expect(screen.getByRole("table", { name: "Synthetic rank awards · not payable" })).toBeVisible();
    const distance = screen.getByRole("region", { name: "League participation" });
    expect(within(distance).getByRole("status")).toHaveTextContent("missing_distance");
    expect(within(distance).queryByText("Inspect distance shares")).not.toBeInTheDocument();
  });
  it("keeps pot/category choice on reload and localizes the public fixture", () => {
    const view = mount("?stage=five_rounds&pot=1", "hr");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Proba raspodjele kroz pet kola");
    fireEvent.change(screen.getByLabelText("Pregled kategorije nagrada"), { target: { value: "89000000-0000-4000-8000-000000000008" } });
    expect(screen.getByText("Probni klub #1")).toBeVisible(); const query = window.location.search;
    view.unmount(); mount(query, "hr"); expect(screen.getByText("Probni klub #1")).toBeVisible();
    expect(screen.queryByText("Synthetic calculation · No transactions")).not.toBeInTheDocument();
    const club = screen.getByRole("button", { name: "Probni klub #1" });
    fireEvent.click(club);
    const details = within(screen.getByRole("region", { name: "Probni klub #1" }));
    fireEvent.click(details.getByText("Pregled doprinosa članova kluba", { selector: "summary" }));
    fireEvent.click(details.getByText(/^1\. kolo: \d+$/, { selector: "summary" }));
    fireEvent.click(details.getByText("Ostali članovi sa završenom utrkom · ne ubrajaju se", { selector: "summary" }));
    expect(details.getAllByText(/Ne ubraja se u poredak/)[0]).toBeVisible();
  });
});
