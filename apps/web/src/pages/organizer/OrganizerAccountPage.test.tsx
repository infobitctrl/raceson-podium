import { Fragment } from "react";
import { PodiumI18nProvider } from "@/features/rewards/demo/PodiumI18nProvider";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrganizerAccountPage from "@/pages/organizer/OrganizerAccountPage";

const mocks = vi.hoisted(() => ({
  updateAccountSettings: vi.fn(),
  updateAccountType: vi.fn(),
  changePassword: vi.fn(),
  changeEmail: vi.fn(),
  changeUsername: vi.fn(),
  requestPasswordReset: vi.fn(),
  toastError: vi.fn(),
  account: {
    userId: "organizer-1",
    accountType: "owner",
    email: "organizer@example.test",
    emailVerified: true,
    displayName: "Synthetic Organizer",
    firstName: "Synthetic",
    lastName: "Organizer",
    dateOfBirth: "1990-01-01",
    phone: "+385911112222",
    jobTitle: "Race director",
    city: "Sibenik",
    countryCode: "HR",
    bio: "",
    locale: "en",
    timezone: "Europe/Zagreb",
    avatarUrl: "",
    coverImageUrl: null,
    primaryAthleteSlug: "synthetic-organizer",
    primaryAthleteProfileId: "athlete-profile-1",
    requestedRoles: ["athlete", "organizer"],
    websiteUrl: "",
    instagramUrl: "",
    facebookUrl: "",
    linkedinUrl: "",
    youtubeUrl: "",
    tiktokUrl: "",
    xUrl: "",
    gender: null,
    emergencyContactName: "",
    emergencyContactPhone: "",
    shirtSize: "",
    organizerSetupEnabled: true,
    organizationNames: ["Ši Trail Liga"],
    authProviders: ["email"],
    loginUsername: "synthetic.organizer",
    usernameChangeAvailableAt: null,
    hasAthleteAccess: true,
    hasOrganizerAccess: true,
    isMasterAdmin: false,
    organizations: [],
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    message: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  hasOrganizerWorkspaceAccess: (account: { hasOrganizerAccess?: boolean; organizerSetupEnabled?: boolean } | null) =>
    Boolean(account?.hasOrganizerAccess || account?.organizerSetupEnabled),
  useAuth: () => ({
    user: { email: "organizer@example.test" },
    account: mocks.account,
    updateAccountSettings: mocks.updateAccountSettings,
    updateAccountType: mocks.updateAccountType,
    enableAthleteProfile: vi.fn(),
    changePassword: mocks.changePassword,
    changeEmail: mocks.changeEmail,
    changeUsername: mocks.changeUsername,
    requestPasswordReset: mocks.requestPasswordReset,
  }),
}));

function renderAccountPage(fixedLanguage = false) {
  const LocaleBoundary = fixedLanguage ? PodiumI18nProvider : Fragment;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/organizer/account"]}>
        <LocaleBoundary><OrganizerAccountPage /></LocaleBoundary>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OrganizerAccountPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.account.locale = "en";
    mocks.account.avatarUrl = "";
    mocks.updateAccountSettings.mockResolvedValue(mocks.account);
    mocks.changePassword.mockResolvedValue(undefined);
    mocks.changeEmail.mockResolvedValue("new-organizer@example.test");
    mocks.updateAccountType.mockResolvedValue(mocks.account);
    mocks.requestPasswordReset.mockResolvedValue({ accepted: true, rateLimited: false });
    mocks.account.emailVerified = true;
  });

  it("keeps an account recovery throttle visible in the security panel", async () => {
    mocks.requestPasswordReset.mockResolvedValue({ accepted: true, rateLimited: true });
    renderAccountPage();

    fireEvent.click(screen.getByText("Password and recovery"));
    fireEvent.click(screen.getByRole("button", { name: "Send password reset email" }));

    const blocker = await screen.findByRole("alert");
    expect(blocker).toHaveTextContent("Password recovery blocked");
    expect(blocker).toHaveTextContent("Blocker: temporary email rate limit");
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it("keeps private details in Profile and opens Public links as a sibling tab", async () => {
    renderAccountPage();

    const accountTypeDisclosure = screen.getByRole("heading", { name: "Account type" }).closest("details");
    const workspaceDisclosure = screen.getByRole("heading", { name: "Workspaces & access" }).closest("details");
    expect(accountTypeDisclosure).not.toHaveAttribute("open");
    expect(workspaceDisclosure).not.toHaveAttribute("open");
    expect(within(accountTypeDisclosure!.querySelector("summary")!).getByText("Athlete + Organizer")).toBeVisible();
    expect(within(workspaceDisclosure!.querySelector("summary")!).getByText("Public · Athlete · Organizer")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Switch workspace/i })).not.toBeInTheDocument();

    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Public links" })).toBeVisible();
    expect(screen.getByLabelText("Display name")).toHaveValue("Synthetic Organizer");
    expect(screen.getByLabelText("Phone")).toHaveValue("+385911112222");
    expect(screen.getByLabelText("City")).toHaveValue("Sibenik");
    expect(screen.getByLabelText("Language")).toHaveValue("en");
    expect(screen.queryByText(/Keep your organizer identity/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Private details used for recovery/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Add every public profile/)).not.toBeInTheDocument();

    const countrySelect = screen.getByLabelText("Country") as HTMLSelectElement;
    expect(countrySelect).toHaveValue("HR");
    expect(Array.from(countrySelect.options).slice(0, 6).map((option) => option.text)).toEqual([
      "Croatia",
      "Slovenia",
      "Hungary",
      "Bosnia and Herzegovina",
      "Serbia",
      "Montenegro",
    ]);
    expect(countrySelect.options.length).toBeGreaterThan(200);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Public links" }), { button: 0 });

    await waitFor(() => expect(screen.getByLabelText("Website")).toBeVisible());
    expect(screen.getByText("Account access")).toBeVisible();
    expect(screen.getByText("Šibenik Trail League")).toBeVisible();
    expect(screen.queryByText("Ši Trail Liga")).not.toBeInTheDocument();
  });

  it("saves edited account information from the same page", async () => {
    renderAccountPage();

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Updated Organizer" },
    });
    fireEvent.click(screen.getByTestId("organizer-account-save"));

    await waitFor(() => {
      expect(mocks.updateAccountSettings).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: "Updated Organizer" }),
      );
    });
  });

  it("preserves stored Croatian when editing an English-only hackathon account", async () => {
    mocks.account.locale = "hr";
    mocks.updateAccountSettings.mockResolvedValue(mocks.account);
    renderAccountPage(true);
    expect(screen.queryByLabelText(/Language/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Updated account" } });
    fireEvent.click(screen.getByTestId("organizer-account-save"));
    await waitFor(() => expect(mocks.updateAccountSettings).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Updated account", locale: "hr" }),
    ));
  });

  it("stores the organizer language preference with the account", async () => {
    renderAccountPage();

    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "hr" },
    });
    fireEvent.click(screen.getByTestId("organizer-account-save"));

    await waitFor(() => {
      expect(mocks.updateAccountSettings).toHaveBeenCalledWith(
        expect.objectContaining({ locale: "hr" }),
      );
    });
  });

  it("uses the shared upload label and avatar remove control", () => {
    mocks.account.avatarUrl = "https://storage.example.test/user-avatars/organizer-1/profile-image?v=1";
    renderAccountPage();

    expect(screen.getByRole("button", { name: "Upload image" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove image" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    expect(screen.queryByRole("button", { name: "Remove image" })).not.toBeInTheDocument();
  });

  it("keeps password controls collapsed until the user opens them", () => {
    renderAccountPage();

    const security = screen.getByText("Password and recovery").closest("details");
    expect(security).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("Password and recovery"));

    expect(security).toHaveAttribute("open");
    expect(screen.getByLabelText("Current password")).toBeVisible();
  });

  it("accepts an eight-character replacement password", async () => {
    renderAccountPage();
    fireEvent.click(screen.getByText("Password and recovery"));

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "old-password" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "12345678" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "12345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(mocks.changePassword).toHaveBeenCalledWith("old-password", "12345678");
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("requests confirmation before changing the organizer email", async () => {
    renderAccountPage();

    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    fireEvent.change(screen.getByLabelText("New email address"), {
      target: { value: "New-Organizer@Example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send confirmation" }));

    await waitFor(() => {
      expect(mocks.changeEmail).toHaveBeenCalledWith(
        "new-organizer@example.test",
        "/organizer/account",
      );
    });
    expect(screen.getByText("Confirmation required")).toBeVisible();
  });
});
