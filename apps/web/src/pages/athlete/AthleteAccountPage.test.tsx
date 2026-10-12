import { Fragment } from "react";
import { PodiumI18nProvider } from "@/features/rewards/demo/PodiumI18nProvider";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AthleteAccountPage from "@/pages/athlete/AthleteAccountPage";
import { uploadAccountAvatar, uploadAccountCoverImage } from "@/lib/account-avatar";

const mocks = vi.hoisted(() => ({
  updateAccountSettings: vi.fn(),
  updateAccountType: vi.fn(),
  deleteAccount: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendVerificationEmail: vi.fn(),
  changeUsername: vi.fn(),
  signOut: vi.fn(),
  toastSuccess: vi.fn(),
  account: {
    userId: "user-1",
    accountType: "athlete",
    email: "athlete@example.test",
    emailVerified: true,
    displayName: "Ana Athlete",
    firstName: "Ana",
    lastName: "Athlete",
    dateOfBirth: "1990-01-01",
    gender: "F",
    city: "Zagreb",
    countryCode: "HR",
    phone: "+385 91 111 2222",
    emergencyContactName: "Ivan Athlete",
    emergencyContactPhone: "+385 91 333 4444",
    shirtSize: "M",
    locale: "en",
    timezone: "Europe/Zagreb",
    avatarUrl: null,
    coverImageUrl: null,
    primaryAthleteSlug: "ana-athlete",
    primaryAthleteProfileId: "athlete-profile-1",
    requestedRoles: ["athlete"],
    organizerSetupEnabled: false,
    hasAthleteAccess: true,
    hasOrganizerAccess: false,
    organizations: [],
    authProviders: ["email"],
    loginUsername: null,
    usernameChangeAvailableAt: null,
  },
}));

vi.mock("@/lib/account-avatar", () => ({
  uploadAccountAvatar: vi.fn(),
  uploadAccountCoverImage: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/lib/auth", () => ({
  hasOrganizerWorkspaceAccess: (account: { hasOrganizerAccess?: boolean; organizerSetupEnabled?: boolean } | null) =>
    Boolean(account?.hasOrganizerAccess || account?.organizerSetupEnabled),
  useAuth: () => ({
    user: { email: "athlete@example.test" },
    account: mocks.account,
    updateAccountSettings: mocks.updateAccountSettings,
    updateAccountType: mocks.updateAccountType,
    deleteAccount: mocks.deleteAccount,
    requestPasswordReset: mocks.requestPasswordReset,
    resendVerificationEmail: mocks.resendVerificationEmail,
    changeUsername: mocks.changeUsername,
    signOut: mocks.signOut,
  }),
}));

vi.mock("@/lib/private-read-models", () => ({
  getFallbackAthleteClubsReadModel: () => ({ memberships: [], suggested: [] }),
  getAthleteClubsReadModel: async () => ({ memberships: [], suggested: [] }),
}));

function renderAccountPage(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }), fixedLanguage = false) {
  const LocaleBoundary = fixedLanguage ? PodiumI18nProvider : Fragment;
  return {
    ...render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/athlete/account?view=edit"]}>
        <LocaleBoundary><AthleteAccountPage /></LocaleBoundary>
      </MemoryRouter>
    </QueryClientProvider>,
    ),
    queryClient,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current account location">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

describe("AthleteAccountPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.account.locale = "en";
    mocks.account.loginUsername = null;
    mocks.account.usernameChangeAvailableAt = null;
    mocks.changeUsername.mockResolvedValue(mocks.account);
    mocks.updateAccountType.mockResolvedValue(mocks.account);
    mocks.requestPasswordReset.mockResolvedValue({ accepted: true, rateLimited: false });
    mocks.account.emailVerified = true;
    Object.assign(mocks.account, {
      dateOfBirth: "1990-01-01",
      gender: "F",
      city: "Zagreb",
      countryCode: "HR",
      phone: "+385 91 111 2222",
      emergencyContactName: "Ivan Athlete",
      emergencyContactPhone: "+385 91 333 4444",
      shirtSize: "M",
    });
  });

  it("shows every missing race field above the public profile and clears errors as fields are completed", () => {
    Object.assign(mocks.account, {
      dateOfBirth: null,
      gender: null,
      phone: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      shirtSize: null,
    });
    renderAccountPage();

    const alertTitle = screen.getByText("Complete the required race information");
    const alert = alertTitle.closest("[role='alert']");
    const publicProfile = screen.getByRole("region", { name: "Public profile" });
    expect(alert).not.toBeNull();
    expect(alert?.nextElementSibling).toBe(publicProfile);
    expect(alert).toHaveTextContent("Date of birth");
    expect(alert).toHaveTextContent("Gender");
    expect(alert).toHaveTextContent("Phone number");
    expect(alert).toHaveTextContent("Emergency Contact Name");
    expect(alert).toHaveTextContent("Emergency Contact Phone");

    const requiredFields = [
      screen.getByLabelText("Date of birth *"),
      screen.getByLabelText("Gender *"),
      screen.getByLabelText("Phone *"),
      screen.getByLabelText("Emergency contact name *"),
      screen.getByLabelText("Emergency contact phone *"),
    ];
    for (const field of requiredFields) {
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveClass("border-destructive");
    }
    expect(screen.getByLabelText("Shirt size (Optional)")).not.toHaveAttribute("aria-invalid");

    fireEvent.change(requiredFields[0], { target: { value: "1990-01-01" } });
    fireEvent.change(requiredFields[1], { target: { value: "F" } });
    fireEvent.change(requiredFields[2], { target: { value: "+385 91 111 2222" } });
    fireEvent.change(requiredFields[3], { target: { value: "Ivan Athlete" } });
    fireEvent.change(requiredFields[4], { target: { value: "+385 91 333 4444" } });

    expect(screen.queryByText("Complete the required race information")).not.toBeInTheDocument();
    for (const field of requiredFields) {
      expect(field).not.toHaveAttribute("aria-invalid");
      expect(field).not.toHaveClass("border-destructive");
    }
  });

  it("prints the password-recovery email rate limit instead of claiming success", async () => {
    mocks.requestPasswordReset.mockResolvedValue({ accepted: true, rateLimited: true });
    renderAccountPage();

    fireEvent.click(screen.getByRole("button", { name: "Send reset email" }));

    const blocker = await screen.findByRole("alert");
    expect(blocker).toHaveTextContent("Password recovery blocked");
    expect(blocker).toHaveTextContent("No new email was sent");
    expect(blocker).toHaveTextContent("Blocker: temporary email rate limit");
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("requires a verified account email before enabling password recovery", () => {
    mocks.account.emailVerified = false;
    renderAccountPage();

    expect(screen.getByText("Confirm your account email before using password recovery.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Send reset email" })).toBeDisabled();
  });

  it("opens the account landing page directly in the public-profile editor", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/athlete/account"]}>
          <AthleteAccountPage />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "Current account location" }))
        .toHaveTextContent("/athlete/account?view=edit#athlete-public-profile");
    });
    expect(screen.queryByRole("navigation", { name: "Athlete account menu" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Public profile" })).toBeVisible();
  });

  it("does not redirect back to My Account after navigation leaves the account route", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/athlete/account?view=edit#athlete-public-profile"]}>
          <AthleteAccountPage />
          <Link to="/athlete/dashboard">Leave My Account</Link>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Leave My Account" }));

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "Current account location" }))
        .toHaveTextContent("/athlete/dashboard");
    });
  });

  it("lets an email account choose a username from My Account", async () => {
    renderAccountPage();

    expect(screen.getByRole("heading", { name: "Workspaces & access" })).toBeVisible();

    const accountPreferences = screen
      .getByRole("heading", { name: "Account preferences" })
      .closest("section");
    expect(accountPreferences).not.toBeNull();
    expect(within(accountPreferences!).getByText("Username")).toBeVisible();
    expect(screen.getByRole("link", { name: "Choose username" })).toHaveAttribute(
      "href",
      "#athlete-login-username",
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose username" }));
    fireEvent.change(screen.getByLabelText("New username"), {
      target: { value: "ana.runner" },
    });
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "current-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save username" }));

    await waitFor(() => {
      expect(mocks.changeUsername).toHaveBeenCalledWith("ana.runner", "current-password");
    });
  });

  it("uploads a selected image and stages its URL for account saving", async () => {
    vi.mocked(uploadAccountAvatar).mockResolvedValue(
      "https://storage.example.test/user-avatars/user-1/profile-image?v=1",
    );
    renderAccountPage();

    const input = screen.getByTestId("athlete-avatar-file-input");
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadAccountAvatar).toHaveBeenCalledWith("user-1", file);
    });
    fireEvent.click(screen.getByText("Custom image URL"));
    expect(screen.getByLabelText("Profile image URL"))
      .toHaveValue("https://storage.example.test/user-avatars/user-1/profile-image?v=1");
    expect(mocks.toastSuccess)
      .toHaveBeenCalledWith("Image uploaded. Save your account settings to publish it.");
    expect(screen.getByRole("button", { name: "Remove image" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Upload image" })).toBeVisible();
    expect(screen.getByAltText("Ana Athlete public profile avatar preview"))
      .toHaveAttribute("src", "https://storage.example.test/user-avatars/user-1/profile-image?v=1");

    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    expect(screen.queryByRole("button", { name: "Remove image" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Profile image URL")).toHaveValue("");
  });

  it("uploads a cover photo and stages it for the public profile", async () => {
    vi.mocked(uploadAccountCoverImage).mockResolvedValue(
      "https://storage.example.test/user-avatars/user-1/profile-cover-image?v=2",
    );
    renderAccountPage();

    const input = screen.getByTestId("athlete-cover-file-input");
    const file = new File(["cover"], "cover.webp", { type: "image/webp" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadAccountCoverImage).toHaveBeenCalledWith("user-1", file);
    });
    expect(screen.getByAltText("Current profile cover"))
      .toHaveAttribute("src", "https://storage.example.test/user-avatars/user-1/profile-cover-image?v=2");
    expect(screen.getByAltText("Ana Athlete public profile cover preview"))
      .toHaveAttribute("src", "https://storage.example.test/user-avatars/user-1/profile-cover-image?v=2");
    expect(mocks.toastSuccess)
      .toHaveBeenCalledWith("Cover photo uploaded. Save your changes to publish it.");
  });

  it("lets a claimed athlete select a built-in trail avatar", () => {
    renderAccountPage();

    fireEvent.click(screen.getByText("Built-in avatars"));
    fireEvent.click(screen.getByRole("button", { name: "Female trail avatar 1" }));

    expect(screen.getByRole("button", { name: "Female trail avatar 1" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Profile image URL"))
      .toHaveValue("/athlete-avatars/female/female-avatar-01.webp");
  });

  it("defaults the registration country to Croatia and prioritizes nearby countries", () => {
    renderAccountPage();

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
  });

  it("keeps one public identity editor without duplicate in-page navigation", () => {
    renderAccountPage();

    expect(screen.queryByRole("navigation", { name: "Athlete workspace sections" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Profile settings sections" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Public profile" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Live public profile preview" })).toBeVisible();
    expect(screen.getByText("Live public preview")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Public details" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Private details" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Account preferences" })).toBeVisible();
    expect(screen.getByText("Community")).toBeVisible();
    expect(screen.getByText("Built-in avatars")).toBeVisible();
    expect(screen.getAllByLabelText("Display name *")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Profile photos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Public info" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Public profile preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My Account" })).toBeVisible();
    expect(screen.getByTestId("account-settings-save")).toBeDisabled();
    expect(screen.queryByText("All changes saved")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Public profile" })).toHaveAttribute("href", "/athletes/ana-athlete");
  });

  it("uses compact paired rows for short public profile fields on mobile", () => {
    renderAccountPage();

    const displayNameField = screen.getByLabelText("Display name *");
    const firstNameField = screen.getByLabelText("First name *");
    const lastNameField = screen.getByLabelText("Last name *");
    const profileHandleField = screen.getByLabelText("Profile handle");
    const publicDetailsGrid = displayNameField.parentElement?.parentElement;

    expect(publicDetailsGrid).toHaveClass("grid-cols-2", "gap-x-2", "gap-y-2");
    expect(displayNameField.parentElement).toHaveClass("col-span-2", "xl:col-span-1");
    expect(firstNameField.parentElement).not.toHaveClass("col-span-2");
    expect(lastNameField.parentElement).not.toHaveClass("col-span-2");
    expect(profileHandleField.parentElement).toHaveClass("col-span-2", "xl:col-span-1");
    expect(screen.getByRole("region", { name: "Live public profile preview" }))
      .toHaveClass("min-h-[205px]", "sm:min-h-[230px]");
  });

  it("shows compact save actions only while account changes are pending", async () => {
    mocks.updateAccountSettings.mockResolvedValue({ ...mocks.account, displayName: "Ana Updated" });
    renderAccountPage();

    expect(screen.queryByText("unsaved change")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Display name *"), { target: { value: "Ana Updated" } });

    expect(screen.getByText("1 unsaved change")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Live public profile preview" }))
      .getByRole("heading", { name: "Ana Updated" })).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Save account" })[0]);

    await waitFor(() => {
      expect(mocks.updateAccountSettings).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: "Ana Updated" }),
      );
    });
  });

  it("preserves stored Croatian when editing an English-only hackathon account", async () => {
    mocks.account.locale = "hr";
    mocks.updateAccountSettings.mockResolvedValue(mocks.account);
    renderAccountPage(undefined, true);
    expect(screen.queryByLabelText(/Language/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Display name *"), { target: { value: "Updated account" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save account" })[0]);
    await waitFor(() => expect(mocks.updateAccountSettings).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Updated account", locale: "hr" }),
    ));
  });

  it("stores the athlete language preference with the account", async () => {
    mocks.updateAccountSettings.mockResolvedValue({ ...mocks.account, locale: "hr" });
    renderAccountPage();

    fireEvent.change(screen.getByLabelText(/Language/), { target: { value: "hr" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save account" })[0]);

    await waitFor(() => {
      expect(mocks.updateAccountSettings).toHaveBeenCalledWith(
        expect.objectContaining({ locale: "hr" }),
      );
    });
  });

  it("updates the shared public athlete profile cache after saving an image", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["public-athletes-catalog"], [{
      id: "ana-athlete",
      name: "Ana Athlete",
      club: "Independent",
      region: "Croatia",
      ageCategory: null,
      finishes: 0,
      gender: "F",
      avatar: "AA",
      avatarUrl: null,
      coverImageUrl: null,
      podiums: 0,
      wins: 0,
      totalDistanceKm: 0,
      totalElevationM: 0,
    }]);
    mocks.updateAccountSettings.mockResolvedValue({
      ...mocks.account,
      avatarUrl: "/athlete-avatars/female/female-avatar-01.webp",
    });
    renderAccountPage(queryClient);

    fireEvent.click(screen.getByText("Built-in avatars"));
    fireEvent.click(screen.getByRole("button", { name: "Female trail avatar 1" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Save account" })[0]);

    await waitFor(() => {
      expect(queryClient.getQueryData<Array<{ avatarUrl: string | null }>>(["public-athletes-catalog"]))
        .toEqual([expect.objectContaining({ avatarUrl: "/athlete-avatars/female/female-avatar-01.webp" })]);
    });
  });
});

it("saves a private meal preference for future race forms", async () => {
  mocks.updateAccountSettings.mockResolvedValue({ ...mocks.account, mealPreference: "Vegetarian" });
  renderAccountPage();
  fireEvent.change(screen.getByRole("textbox", { name: /Meal preference/ }), { target: { value: "Vegetarian" } });
  fireEvent.click(screen.getByTestId("account-settings-save"));
  await waitFor(() => expect(mocks.updateAccountSettings).toHaveBeenCalledWith(expect.objectContaining({ mealPreference: "Vegetarian" })));
});
