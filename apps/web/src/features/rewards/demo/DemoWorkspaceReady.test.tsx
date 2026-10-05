import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DemoWorkspaceReady from "./DemoWorkspaceReady";

const fixture = vi.hoisted(() => ({ defaultOrganizationId: null as string | null, organizations: [{ organizationId: "org-2" }], isPlatformSupportMode: false }));
vi.mock("@/lib/organizer-workspace", () => ({ useOrganizerWorkspace: () => fixture }));
vi.mock("@/shared/i18n/I18nContext", () => ({ useI18n: () => ({ t: () => "Loading rewards…" }) }));
beforeEach(() => { fixture.defaultOrganizationId = null; fixture.organizations = [{ organizationId: "org-2" }]; });
function mount() { return render(<MemoryRouter><Routes><Route element={<DemoWorkspaceReady />}>
  <Route path="/" element={<h1>Scoped classic page</h1>} />
</Route></Routes></MemoryRouter>); }
it("holds data-fetching pages until the classic provider restores its workspace", () => {
  mount(); expect(screen.getByRole("status")).toHaveTextContent("Loading rewards");
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
});
it("mounts the classic page after workspace restoration", () => {
  fixture.defaultOrganizationId = "org-2"; mount(); expect(screen.getByRole("heading")).toBeVisible();
});
it("does not trap an account with no organizations in a loading state", () => {
  fixture.organizations = []; mount(); expect(screen.getByRole("heading")).toBeVisible();
});
