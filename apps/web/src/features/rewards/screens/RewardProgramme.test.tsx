import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import RewardProgramme from "./RewardProgramme";

function mount(query = "", locale: "en" | "hr" = "en") {
  window.history.replaceState({}, "", "/rewards" + query);
  return render(<I18nProvider initialLocale={locale}><BrowserRouter><RewardProgramme /></BrowserRouter></I18nProvider>);
}
const inspector = () => screen.getByRole("region", { name: "Selected allocation" });
async function settings() {
  fireEvent.click(screen.getByRole("button", { name: "Configure preview" }));
  return screen.findByRole("form", { name: "Programme settings" }, { timeout: 5000 });
}
describe("v2 shared programme screen", () => {
  it("shows 100000, one 24h review and honest unknown funding without invented awards", () => {
    mount();
    expect(screen.getAllByText("100,000 test MON").length).toBeGreaterThan(0);
    expect(screen.getByText("Interactive preview · Not saved or funded")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Platform review" })).toBeVisible();
    fireEvent.click(within(inspector()).getByText("Contract and payment evidence"));
    for (const text of ["Funding: not verified", "Contract: not linked to this draft", "Payments: no receipts linked"]) {
      expect(within(inspector()).getByText(text)).toBeVisible();
    }
    expect(screen.getByText(/reset on reload/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /pay|send|claim/i })).not.toBeInTheDocument();
  });
  it("drills from a round to its top-ten prize curve and preserves selection on reload", () => {
    const view = mount("?node=subicevac");
    expect(within(inspector()).getByText("10,000 test MON")).toBeVisible();
    fireEvent.click(within(inspector()).getByText("Result evidence needed"));
    expect(within(inspector()).getAllByText(/3 October 2026/)[0]).toBeVisible();
    fireEvent.click(within(inspector()).getByRole("button", { name: "Athlete standings 8,000 test MON" }));
    fireEvent.click(within(inspector()).getByText("Prize share by finishing place"));
    fireEvent.click(within(inspector()).getByText("See every prize slot"));
    const curve = within(inspector()).getByRole("table", { name: "Race prize curve · top 10" });
    expect(within(curve).getAllByRole("row")).toHaveLength(11);
    expect(within(curve).getByText("35%")).toBeVisible();
    expect(within(curve).getByText("1.5%")).toBeVisible();
    const query = window.location.search; view.unmount(); mount(query);
    expect(within(inspector()).getByRole("heading", { level: 2 })).toHaveTextContent("Athlete standings");
  });
  it("shows top-25 league shares and distance participation without wallet filtering", () => {
    mount("?node=league:athlete_standings");
    fireEvent.click(within(inspector()).getByText("Prize share by finishing place"));
    fireEvent.click(within(inspector()).getByText("See every prize slot"));
    const curve = within(inspector()).getByRole("table", { name: "League prize curve · top 25" });
    expect(within(curve).getAllByRole("row")).toHaveLength(26);
    expect(within(curve).getByText("30%")).toBeVisible();
    fireEvent.click(screen.getByText("Explore all allocations"));
    fireEvent.change(screen.getByRole("combobox", { name: "Selected allocation" }), { target: { value: "league:participation_metres" } });
    expect(within(inspector()).getByText("15,000 test MON")).toBeVisible();
    fireEvent.click(within(inspector()).getByText("View allocation rules"));
    expect(within(inspector()).getByText(/Unclaimed profiles and athletes without wallets keep their shares/)).toBeVisible();
  });
  it("applies the same preview in both layouts, with selection intact and no save claim", async () => {
    mount("?node=subicevac");
    const form = await settings();
    fireEvent.change(within(form).getByRole("textbox", { name: "Total pot (test MON)" }), { target: { value: "200000" } });
    fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(form).getByRole("button", { name: "Apply to preview" }));
    expect(within(inspector()).getByText("20,000 test MON")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Portal layout" }));
    expect(window.location.search).toBe("?node=subicevac&view=portal");
    expect(within(inspector()).getByText("20,000 test MON")).toBeVisible();
    expect(screen.getByRole("complementary", { name: "League workspace" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Rewards app" }));
    expect(within(inspector()).getByText("20,000 test MON")).toBeVisible();
    expect(screen.queryByRole("complementary", { name: "League workspace" })).not.toBeInTheDocument();
  });
  it("rejects invalid totals without changing the displayed budget and cancel restores focus", async () => {
    mount();
    const form = await settings();
    fireEvent.change(within(form).getByRole("textbox", { name: "League rewards" }), { target: { value: "51" } });
    fireEvent.click(within(form).getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent("each percentage group must total 100");
    expect(screen.queryByRole("region", { name: "Selected allocation" })).not.toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(within(inspector()).getByText("100,000 test MON")).toBeVisible();
    expect(screen.getByRole("button", { name: "Configure preview" })).toHaveFocus();
  });
  it("restores the suggested preset and reload does not pretend to persist a draft", async () => {
    const view = mount();
    const form = await settings();
    fireEvent.change(within(form).getByRole("textbox", { name: "Total pot (test MON)" }), { target: { value: "200000" } });
    fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(form).getByRole("button", { name: "Apply to preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore suggested preset" }));
    expect(within(inspector()).getByText("100,000 test MON")).toBeVisible();
    view.unmount(); mount("?view=portal&node=league");
    expect(within(inspector()).getByText("50,000 test MON")).toBeVisible();
  });
  it("keeps pending edits while switching presentation and does not leak inputs into the URL", async () => {
    mount();
    const form = await settings();
    fireEvent.change(within(form).getByRole("textbox", { name: "Total pot (test MON)" }), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Portal layout" }));
    expect(screen.getByRole("textbox", { name: "Total pot (test MON)" })).toHaveValue("123456");
    expect(window.location.search).not.toContain("123456");
    expect(window.localStorage.getItem("reward-draft")).toBeNull();
  });
  it("localizes the preview, portal mode and exact totals into Croatian", () => {
    mount("?view=portal&node=league:club_standings", "hr");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Primjer kalkulatora raspodjele");
    const panel = screen.getByRole("region", { name: "Odabrana raspodjela" });
    expect(within(panel).getByRole("heading", { level: 2 })).toHaveTextContent("Poredak klubova");
    expect(within(panel).getByText("10.000 testnih MON")).toBeVisible();
    expect(screen.getByRole("button", { name: "Uredi pregled" })).toBeVisible();
    expect(screen.queryByText("Interactive preview · Not saved or funded")).not.toBeInTheDocument();
  });
  it("keeps custom weights through back navigation and blocks increasing prize weights", async () => {
    mount("?node=vrpolje:athlete_standings");
    const form = await settings();
    fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
    expect(within(form).queryByRole("button", { name: "Apply to preview" })).not.toBeInTheDocument();
    fireEvent.click(within(form).getByText("Customize prize weights"));
    const firstWeight = within(form).getByRole("textbox", { name: "Place 1 weight" });
    fireEvent.change(firstWeight, { target: { value: "1000" } });
    fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
    expect(within(form).getByRole("alert")).toBeVisible();
    expect(within(form).queryByRole("img", { name: "Race prize curve · top 10" })).not.toBeInTheDocument();
    fireEvent.change(firstWeight, { target: { value: "4000" } });
    fireEvent.click(within(form).getByRole("button", { name: "Back" }));
    fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
    expect(within(form).getByRole("textbox", { name: "Place 1 weight" })).toHaveValue("4000");
    fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(form).getByRole("button", { name: "Apply to preview" }));
    fireEvent.click(within(inspector()).getByText("Prize share by finishing place"));
    fireEvent.click(within(inspector()).getByText("See every prize slot"));
    expect(within(inspector()).getByText("38.1%")).toBeVisible();
  });
});

// Chart geometry and selection are exercised in the browser; jsdom has no layout.
vi.mock("../components/ProgrammeFlowChart", () => ({ default: () => null }));

// Chart geometry is browser-verified; these tests exercise workspace behavior.
vi.mock("../components/DistributionFlowChart",()=>({default:()=>null}));
