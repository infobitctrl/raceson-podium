import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { createDefaultRewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import SavedRewardProgramme from "./SavedRewardProgramme";
vi.mock("./ProgrammeSourceMapping", () => ({ default: () => <section id="source-mapping" /> }));
vi.mock("../data/programmeFundingV3", () => ({ readProgrammeFundingV3: async () => ({ status: "awaiting_deployment", observation: null }) }));
vi.mock("./ProgrammeFundingV3", () => ({ default: () => <section id="programme-funding" /> }));

const fixture = vi.hoisted(() => ({ user: { id: "organizer" } as { id: string } | null, organizer: true, session: {}, organizationId: "org-2",
  list: vi.fn(), read: vi.fn(), save: vi.fn(), selectOrganization: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: fixture.user, session: fixture.session,
  account: fixture.user ? { userId: fixture.user.id, hasOrganizerAccess:fixture.organizer } : null, isLoading: false }) }));
vi.mock("@/lib/organizer-workspace", () => ({ useOrganizerWorkspace: () => ({ selectedOrganizationId: fixture.organizationId,
  organizations: [{ organizationId: "org-2" }], selectOrganization: fixture.selectOrganization }),
  organizerWorkspaceSessionStorageKey: (id: string) => `synthetic-workspace-${id}` }));
vi.mock("../data/planningDrafts", () => ({ listPlanningDrafts: () => fixture.list(), readPlanningDraft: (record: unknown) => fixture.read(record),
  savePlanningDraft: (record: unknown, rules: unknown) => fixture.save(record, rules) }));
function record() { return { draftId: "draft-1", organizationId: "org-2", seasonId: "season-1", chainId: 31337,
  organizationName: "Synthetic organization", seasonName: "Synthetic league · 2026", revision: 1,
  updatedAt: "2026-09-09T12:00:00Z", rules: createDefaultRewardProgrammeDraftV2() }; }
function mount(integrated = false) {
  window.history.replaceState({}, "", integrated ? "/organizer/reward-planner" : "/rewards/manage");
  return render(<I18nProvider initialLocale="en"><BrowserRouter><SavedRewardProgramme integrated={integrated} /></BrowserRouter></I18nProvider>);
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function() { this.removeAttribute("open"); };
  fixture.user = { id: "organizer" }; fixture.organizer = true; fixture.organizationId = "org-2";
  fixture.selectOrganization.mockReset().mockImplementation(id => { fixture.organizationId = id; });
  fixture.list.mockReset().mockResolvedValue([record()]); fixture.read.mockReset().mockImplementation(async r => r);
  fixture.save.mockReset().mockImplementation(async (r, rules) => ({ ...r, rules, revision: r.revision + 1 }));
});
async function edit() {
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  await screen.findByText("Saved in demo database · Revision 1");
  fireEvent.click(screen.getByRole("button", { name: "Configure preview" }));
  const form = await screen.findByRole("form", { name: "Programme settings" });
  fireEvent.change(within(form).getByRole("textbox", { name: "Total pot (test MON)" }), { target: { value: "120000" } });
  fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
  fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
  fireEvent.click(within(form).getByRole("button", { name: "Apply to preview" }));
}
describe("saved reward settings", () => {
  it("explains organizer access to athletes without fetching drafts or rendering dead section links", () => {
    fixture.organizer=false; mount();
    expect(screen.getByText("Funding, race mapping and distribution settings require an organizer account.")).toBeVisible();
    expect(screen.getByRole("link",{name:"Back to my rewards"})).toHaveAttribute("href","/athlete/rewards");
    expect(screen.queryByRole("link",{name:"Race and category mapping"})).not.toBeInTheDocument();
    expect(fixture.list).not.toHaveBeenCalled();
  });
  it("keeps setup in a focused dialog and shows the distribution workspace by default", async () => {
    mount(); expect(await screen.findByRole("button", { name: "Settings" })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Programme settings" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Selected allocation" })).not.toBeInTheDocument();
    expect(screen.getByText("100000")).toBeVisible();
  });
  it("keeps the anonymous preview separate and asks for demo sign-in", async () => {
    fixture.user = null; mount(); expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth?next=%2Frewards%2Fmanage");
    expect(fixture.list).not.toHaveBeenCalled();
  });
  it("loads an authorized saved revision, then saves validated edited rules", async () => {
    mount(); await edit(); expect(screen.getByText(/Unsaved changes/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save reward settings" }));
    expect(await screen.findByText("Saved in demo database · Revision 2")).toBeVisible();
    expect(fixture.save).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }), expect.objectContaining({ budgetMon: "120000", reviewSeconds: 86400 }));
    expect(screen.queryByText("Interactive preview · Not saved or funded")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save reward settings" })).toBeDisabled();
  });
  it("keeps edits on a revision conflict without claiming they were saved", async () => {
    fixture.save.mockRejectedValue(Object.assign(new Error("conflict"), { code: "reward_planning_revision_changed" }));
    mount(); await edit(); fireEvent.click(screen.getByRole("button", { name: "Save reward settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Another tab saved a newer revision");
    expect(screen.getByText(/Unsaved changes/)).toBeVisible();
    expect(screen.queryByText("Saved in demo database · Revision 2")).not.toBeInTheDocument();
  });
  it("preserves unsaved rules when the settings dialog closes and reopens", async () => {
    mount(); await edit();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText(/Unsaved changes/)).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Review Round 3" }));
    expect(new URLSearchParams(window.location.search).get("pot")).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText(/Unsaved changes/)).toBeVisible();
    expect(fixture.read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Save reward settings" }));
    expect(await screen.findByText("Saved in demo database · Revision 2")).toBeVisible();
    expect(fixture.save).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }), expect.objectContaining({ budgetMon: "120000" }));
  });
  it("does not display another organization’s draft inside the selected classic workspace", async () => {
    fixture.organizationId = "different-org"; mount(true);
    expect(await screen.findByText("No reward planning drafts are available to this account.")).toBeVisible();
    expect(fixture.read).not.toHaveBeenCalled();
  });
  it("does not silently substitute a different draft for an unknown requested ID", async () => {
    window.history.replaceState({}, "", "/rewards/manage?draft=unknown");
    render(<I18nProvider initialLocale="en"><BrowserRouter><SavedRewardProgramme /></BrowserRouter></I18nProvider>);
    expect(await screen.findByText("No reward planning drafts are available to this account.")).toBeVisible();
    expect(fixture.read).not.toHaveBeenCalled();
  });
  it.each(["en", "hr"] as const)("offers an explicit workspace switch for an authorized deep link in %s, without reading foreign detail first", async locale => {
    fixture.organizationId = "different-org";
    window.history.replaceState({}, "", "/organizer/reward-planner?draft=draft-1");
    const view = render(<I18nProvider initialLocale={locale}><BrowserRouter><SavedRewardProgramme integrated /></BrowserRouter></I18nProvider>);
    const button = await screen.findByRole("button", { name: locale === "en" ? "Switch to Synthetic organization" : "Prijeđi na Synthetic organization" });
    expect(fixture.read).not.toHaveBeenCalled(); expect(fixture.selectOrganization).not.toHaveBeenCalled();
    fireEvent.click(button); expect(fixture.selectOrganization).toHaveBeenCalledWith("org-2");
    view.rerender(<I18nProvider initialLocale={locale}><BrowserRouter><SavedRewardProgramme integrated /></BrowserRouter></I18nProvider>);
    await waitFor(() => expect(fixture.read).toHaveBeenCalledWith(expect.objectContaining({ draftId: "draft-1", organizationId: "org-2" })));
    expect(fixture.save).not.toHaveBeenCalled();
  });
  it("clears the visible private draft when the authenticated identity disappears", async () => {
    const view = mount(); fireEvent.click(await screen.findByRole("button", { name: "Settings" })); await screen.findByText("Saved in demo database · Revision 1"); fixture.user = null;
    view.rerender(<I18nProvider initialLocale="en"><BrowserRouter><SavedRewardProgramme /></BrowserRouter></I18nProvider>);
    await waitFor(() => expect(screen.queryByText("Synthetic organization / Synthetic league · 2026")).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Sign in" })).toBeVisible();
  });
});

// Chart geometry and selection are exercised in the browser; jsdom has no layout.
vi.mock("../components/ProgrammeFlowChart", () => ({ default: () => null }));

// Chart geometry is browser-verified; these tests exercise workspace behavior.
vi.mock("../components/DistributionFlowChart",()=>({default:()=>null}));
