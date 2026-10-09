import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthPage from "@/pages/AuthPage";

vi.mock("@/lib/public-env", () => ({publicEnv:{rewardDemo:{mode:"local-testnet"}}}));

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
  cancelPendingSignUp: vi.fn(),
  checkSignUpAvailability: vi.fn(),
  resendVerificationEmail: vi.fn(),
  findAthleteProfileMatches: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motion = new Proxy({}, {
    get: (_target, tag: string) => ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: Record<string, unknown>) => React.createElement(
      tag,
      props,
      children as React.ReactNode,
    ),
  });

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion,
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    account: null,
    hasSupabase: true,
    isLoading: false,
    signIn: mocks.signIn,
    signUp: mocks.signUp,
    cancelPendingSignUp: mocks.cancelPendingSignUp,
    checkSignUpAvailability: mocks.checkSignUpAvailability,
    resendVerificationEmail: mocks.resendVerificationEmail,
    getDefaultRoute: () => "/athlete",
    refreshAccountContext: vi.fn(),
    user: null,
  }),
}));

vi.mock("@/features/accounts/data/identityGovernance", () => ({
  completeAthleteProfileEmailClaim: vi.fn(),
  findAthleteProfileMatches: mocks.findAthleteProfileMatches,
}));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}{location.search}{location.hash}</output>;
}

function renderSignup(entry = "/auth?mode=signup") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[entry]}>
        <AuthPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderLogin() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/auth?mode=login"]}>
        <AuthPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Podium demo account entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signIn.mockResolvedValue(null);
  });

  it("retains a disabled sponsor form for direct registration URLs", () => {
    renderSignup();
    expect(screen.getByRole("heading", {name: "Create sponsor account"})).toBeInTheDocument();
    for (const label of ["Full name", "Username", "Email address", "Password"]) {
      expect(screen.getByLabelText(label, {exact: true})).toBeDisabled();
    }
    expect(screen.getByRole("button", {name: "Show password"})).toBeDisabled();
    expect(screen.getByRole("button", {name: "Create sponsor account", exact: true})).toBeDisabled();
    expect(screen.getByText(/Only demo user accounts are available/)).toBeInTheDocument();
    expect(screen.getByText(/Live RacesOn accounts are not connected yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Already an athlete or organizer/)).not.toBeInTheDocument();
    fireEvent.submit(screen.getByLabelText("Full name").closest("form")!);
    expect(mocks.checkSignUpAvailability).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("disables registration entry points on login and keeps keyboard navigation on sign-in", () => {
    renderLogin();
    expect(screen.getByRole("tab", {name: /Create sponsor account/})).toBeDisabled();
    expect(screen.getByRole("button", {name: "Create sponsor account", exact: true})).toBeDisabled();
    const signInTab = screen.getByRole("tab", {name: "Sign in"});
    fireEvent.keyDown(signInTab, {key: "ArrowRight"});
    expect(signInTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Username or email")).toBeEnabled();
    expect(screen.getByLabelText("Password", {exact: true})).toBeEnabled();
  });

  it("returns from disabled signup to working demo sign-in with the campaign return path", async () => {
    renderSignup("/auth?mode=signup&next=%2Frewards%2Fcampaigns%2Fnew&claim=some-athlete");
    fireEvent.click(screen.getByRole("tab", {name: "Sign in"}));
    fireEvent.change(screen.getByLabelText("Username or email"), {target: {value: "demo.sponsor"}});
    fireEvent.change(screen.getByLabelText("Password", {exact: true}), {target: {value: "synthetic-password"}});
    fireEvent.click(screen.getByRole("button", {name: "Sign in", exact: true}));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith({identifier: "demo.sponsor", password: "synthetic-password"}));
    await waitFor(() => expect(screen.getByLabelText("Current location")).toHaveTextContent("/rewards/campaigns/new"));
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("allows retry after demo sign-in fails without enabling registration", async () => {
    mocks.signIn.mockRejectedValueOnce(new Error("Sign-in failed"));
    renderSignup();
    fireEvent.click(screen.getByRole("tab", {name: "Sign in"}));
    fireEvent.change(screen.getByLabelText("Username or email"), {target: {value: "demo.sponsor"}});
    fireEvent.change(screen.getByLabelText("Password", {exact: true}), {target: {value: "synthetic-password"}});
    fireEvent.click(screen.getByRole("button", {name: "Sign in", exact: true}));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", {name: "Sign in", exact: true})).toBeEnabled();
    expect(screen.getByLabelText("Username or email")).toHaveValue("demo.sponsor");
    expect(screen.getByRole("tab", {name: /Create sponsor account/})).toBeDisabled();
  });
});
