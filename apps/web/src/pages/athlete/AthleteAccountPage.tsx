import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  AtSign,
  Building2,
  CalendarClock,
  Camera,
  CheckCircle2,
  ChevronDown,
  ImageIcon,
  KeyRound,
  RotateCcw,
  Save,
  Shield,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadAccountAvatar, uploadAccountCoverImage } from "@/lib/account-avatar";
import { useAuth } from "@/lib/auth";
import { sanitizeLocalAppPath } from "@/lib/navigation";
import {
  formatProviderLabel,
  getAccountCompletion,
  getRaceProfileCompletion,
} from "@/lib/account-presentation";
import { localAuthInboxUrl } from "@/lib/auth-security";
import { organizationCountryOptions } from "@/features/accounts/model/organizationLocation";
import { AccountAvatarControl } from "@/features/accounts/components/AccountAvatarControl";
import { AccountAppearancePreference } from "@/features/accounts/components/AccountAppearancePreference";
import { AccountTypeControl } from "@/features/accounts/components/AccountTypeControl";
import { AthleteRaceHistorySearch } from "@/features/accounts/components/AthleteRaceHistorySearch";
import { AccountUsernameControl } from "@/features/accounts/components/AccountUsernameControl";
import { AccountEmailControl } from "@/features/accounts/components/AccountEmailControl";
import { formatAuthError } from "@/features/accounts/model/authErrorMessages";
import { ProfileAvatarPicker } from "@/features/accounts/components/ProfileAvatarPicker";
import { AthletePublicProfileLivePreview } from "@/features/athletes/components/AthletePublicProfileLivePreview";
import { stagePublicAthleteProfileCache } from "@/features/athletes/data/publicAthleteProfileCache";
import { getAthleteClubsReadModel, getFallbackAthleteClubsReadModel } from "@/lib/private-read-models";
import { sumAthleteResultDistanceKm } from "@/features/athletes/model/profileDistance";
import { getPublicAthleteResultsReadModel } from "@/lib/portal-read-models";
import { platformAgeCategory } from "@/shared/domain/ageCategories";
import { brandLandscapes } from "@/assets/brand-landscapes";
import { WorkspaceAccessSummary } from "@/shared/navigation/WorkspaceAccessSummary";
import { useI18n } from "@/shared/i18n/I18nContext";
import { normalizeAppLocale } from "@/shared/i18n/locales";

const clubRidgeImage = brandLandscapes.karstMeadowPath;

function formatMembershipRole(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function SectionCard({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-3 rounded-2xl border border-border/70 bg-card/95 p-3 shadow-soft sm:rounded-[22px] sm:p-5">
      <div className="mb-3 sm:mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">{eyebrow}</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h2 className="font-display text-lg font-bold text-foreground">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

const emptyResults = {
  seasonStats: {
    totalParticipations: 0,
    totalRaces: 0,
    totalFinishes: 0,
    podiums: 0,
    wins: 0,
    avgFinish: "TBA",
  },
  results: [],
};

export default function AthleteAccountPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const coverFileInputRef = useRef<HTMLInputElement>(null);
  const {
    user,
    account,
    updateAccountSettings,
    deleteAccount,
    requestPasswordReset,
    resendVerificationEmail,
    changeEmail,
    changeUsername,
  } = useAuth();
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [isSendingPasswordReset, setIsSendingPasswordReset] = useState(false);
  const [passwordResetFeedback, setPasswordResetFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    displayName: "",
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "",
    city: "",
    countryCode: "HR",
    phone: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    shirtSize: "",
    mealPreference: "",
    locale: "en",
    timezone: "Europe/Zagreb",
    avatarUrl: "",
    coverImageUrl: "",
    organizerSetupEnabled: false,
  });
  const clubsQuery = useQuery({
    queryKey: ["athlete-clubs"],
    queryFn: getAthleteClubsReadModel,
    initialData: getFallbackAthleteClubsReadModel(),
  });
  const publicResultsQuery = useQuery({
    queryKey: ["athlete-results-public", account?.primaryAthleteSlug ?? ""],
    queryFn: () => getPublicAthleteResultsReadModel(account?.primaryAthleteSlug ?? ""),
    enabled: Boolean(account?.primaryAthleteSlug),
    initialData: emptyResults,
  });
  useEffect(() => {
    setSettingsForm({
      displayName: account?.displayName ?? "",
      firstName: account?.firstName ?? "",
      lastName: account?.lastName ?? "",
      dateOfBirth: account?.dateOfBirth ?? "",
      gender: account?.gender ?? "",
      city: account?.city ?? "",
      countryCode: account?.countryCode ?? "HR",
      phone: account?.phone ?? "",
      emergencyContactName: account?.emergencyContactName ?? "",
      emergencyContactPhone: account?.emergencyContactPhone ?? "",
      shirtSize: account?.shirtSize ?? "",
      mealPreference: account?.mealPreference ?? "",
      locale: normalizeAppLocale(account?.locale) ?? "en",
      timezone: account?.timezone ?? "Europe/Zagreb",
      avatarUrl: account?.avatarUrl ?? "",
      coverImageUrl: account?.coverImageUrl ?? "",
      organizerSetupEnabled: account?.organizerSetupEnabled ?? false,
    });
  }, [account]);

  useEffect(() => {
    if (!["#athlete-public-profile", "#athlete-race-history"].includes(location.hash)) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView?.({ block: "start" });
  }, [location.hash]);

  const normalizedSettings = {
    displayName: settingsForm.displayName.trim(),
    firstName: settingsForm.firstName.trim(),
    lastName: settingsForm.lastName.trim(),
    dateOfBirth: settingsForm.dateOfBirth.trim(),
    gender: settingsForm.gender.trim(),
    city: settingsForm.city.trim(),
    countryCode: settingsForm.countryCode.trim().toUpperCase(),
    phone: settingsForm.phone.trim(),
    emergencyContactName: settingsForm.emergencyContactName.trim(),
    emergencyContactPhone: settingsForm.emergencyContactPhone.trim(),
    shirtSize: settingsForm.shirtSize.trim().toUpperCase(),
    mealPreference: settingsForm.mealPreference.trim(),
    locale: settingsForm.locale.trim(),
    timezone: settingsForm.timezone.trim(),
    avatarUrl: settingsForm.avatarUrl.trim(),
    coverImageUrl: settingsForm.coverImageUrl.trim(),
    organizerSetupEnabled: settingsForm.organizerSetupEnabled,
  };

  const pendingChangeChecks = [
    normalizedSettings.displayName !== (account?.displayName ?? "").trim(),
    normalizedSettings.firstName !== (account?.firstName ?? "").trim(),
    normalizedSettings.lastName !== (account?.lastName ?? "").trim(),
    normalizedSettings.dateOfBirth !== (account?.dateOfBirth ?? "").trim(),
    normalizedSettings.gender !== (account?.gender ?? "").trim(),
    normalizedSettings.city !== (account?.city ?? "").trim(),
    normalizedSettings.countryCode !== (account?.countryCode ?? "HR").trim(),
    normalizedSettings.phone !== (account?.phone ?? "").trim(),
    normalizedSettings.emergencyContactName !== (account?.emergencyContactName ?? "").trim(),
    normalizedSettings.emergencyContactPhone !== (account?.emergencyContactPhone ?? "").trim(),
    normalizedSettings.shirtSize !== (account?.shirtSize ?? "").trim(),
    normalizedSettings.mealPreference !== (account?.mealPreference ?? "").trim(),
    normalizedSettings.locale !== (normalizeAppLocale(account?.locale) ?? "en"),
    normalizedSettings.timezone !== (account?.timezone ?? "Europe/Zagreb").trim(),
    normalizedSettings.avatarUrl !== (account?.avatarUrl ?? "").trim(),
    normalizedSettings.coverImageUrl !== (account?.coverImageUrl ?? "").trim(),
    normalizedSettings.organizerSetupEnabled !== (account?.organizerSetupEnabled ?? false),
  ];
  const hasSettingsChanges = pendingChangeChecks.some(Boolean);
  const pendingChangeCount = pendingChangeChecks.filter(Boolean).length;

  const organizationAccess = account?.organizations ?? [];
  const hasDeletionBlocker = organizationAccess.some(
    (membership) => membership.role === "owner" || membership.role === "admin",
  );
  const deleteConfirmationTarget = (account?.email ?? "DELETE").trim();
  const authInboxUrl = localAuthInboxUrl();
  const authProviderLabel = account?.loginUsername
    ? "Username + password"
    : account?.authProviders?.length
    ? account.authProviders.map((provider) => formatProviderLabel(provider)).join(", ")
    : "Email + password";
  const isPasswordAccount = (account?.authProviders ?? []).includes("email")
    || (account?.authProviders ?? []).length === 0;
  const normalizedGender: "F" | "M" | "U" | null =
    normalizedSettings.gender === "F" || normalizedSettings.gender === "M" || normalizedSettings.gender === "U"
      ? normalizedSettings.gender
      : null;
  const draftAccount = account
    ? {
        ...account,
        displayName: normalizedSettings.displayName,
        firstName: normalizedSettings.firstName || null,
        lastName: normalizedSettings.lastName || null,
        dateOfBirth: normalizedSettings.dateOfBirth || null,
        gender: normalizedGender,
        city: normalizedSettings.city || null,
        countryCode: normalizedSettings.countryCode || null,
        phone: normalizedSettings.phone || null,
        emergencyContactName: normalizedSettings.emergencyContactName || null,
        emergencyContactPhone: normalizedSettings.emergencyContactPhone || null,
        shirtSize: normalizedSettings.shirtSize || null,
        mealPreference: normalizedSettings.mealPreference || null,
        locale: normalizedSettings.locale,
        timezone: normalizedSettings.timezone,
        avatarUrl: normalizedSettings.avatarUrl || null,
      }
    : null;
  const raceProfile = getRaceProfileCompletion(draftAccount);
  const missingRequiredRaceFields = [
    {
      id: "athlete-date-of-birth",
      missing: !normalizedSettings.dateOfBirth,
      label: t("profile.raceReadiness.dateOfBirth"),
    },
    {
      id: "athlete-gender",
      missing: !normalizedSettings.gender,
      label: t("profile.raceReadiness.gender"),
    },
    {
      id: "athlete-phone",
      missing: !normalizedSettings.phone,
      label: t("auth.phone"),
    },
    {
      id: "athlete-emergency-name",
      missing: !normalizedSettings.emergencyContactName,
      label: t("registration.field.emergencyName"),
    },
    {
      id: "athlete-emergency-phone",
      missing: !normalizedSettings.emergencyContactPhone,
      label: t("registration.field.emergencyPhone"),
    },
  ].filter((field) => field.missing);
  const accountCompletion = getAccountCompletion(draftAccount);
  const finishedResults = publicResultsQuery.data.results.filter((result) => result.status === "finished");
  const publicDistance = sumAthleteResultDistanceKm(finishedResults);
  const nextPath = sanitizeLocalAppPath(searchParams.get("next"), {
    blockedPathnames: ["/auth", "/athlete/account"],
  });
  const publicProfilePath = account?.primaryAthleteSlug ? `/athletes/${account.primaryAthleteSlug}` : null;
  const ageCategory = platformAgeCategory(normalizedSettings.dateOfBirth, new Date());
  const profileLocation = [
    normalizedSettings.city,
    organizationCountryOptions.find((country) => country.value === normalizedSettings.countryCode)?.label,
  ].filter(Boolean).join(", ");
  const publicRecord = {
    races: publicResultsQuery.data.seasonStats.totalRaces,
    finishes: publicResultsQuery.data.seasonStats.totalFinishes,
    distance: `${publicDistance.toLocaleString()} km`,
    podiums: publicResultsQuery.data.seasonStats.podiums,
  };
  const primaryClub = clubsQuery.data.memberships.find((club) => club.isPrimary) ?? clubsQuery.data.memberships[0] ?? null;
  const showEditor = searchParams.get("view") === "edit" || Boolean(nextPath);
  const previewAvatarUrl = normalizedSettings.avatarUrl || null;
  const publicDataCompletedCount = [
    normalizedSettings.displayName,
    normalizedSettings.firstName,
    normalizedSettings.lastName,
    normalizedSettings.city,
    normalizedSettings.countryCode,
  ].filter(Boolean).length;
  const privateDataCompletedCount = [
    normalizedSettings.dateOfBirth,
    normalizedSettings.gender,
    normalizedSettings.phone,
    normalizedSettings.emergencyContactName,
    normalizedSettings.emergencyContactPhone,
  ].filter(Boolean).length;

  function resetAccountSettings() {
    setSettingsForm({
      displayName: account?.displayName ?? "",
      firstName: account?.firstName ?? "",
      lastName: account?.lastName ?? "",
      dateOfBirth: account?.dateOfBirth ?? "",
      gender: account?.gender ?? "",
      city: account?.city ?? "",
      countryCode: account?.countryCode ?? "HR",
      phone: account?.phone ?? "",
      emergencyContactName: account?.emergencyContactName ?? "",
      emergencyContactPhone: account?.emergencyContactPhone ?? "",
      shirtSize: account?.shirtSize ?? "",
      mealPreference: account?.mealPreference ?? "",
      locale: normalizeAppLocale(account?.locale) ?? "en",
      timezone: account?.timezone ?? "Europe/Zagreb",
      avatarUrl: account?.avatarUrl ?? "",
      coverImageUrl: account?.coverImageUrl ?? "",
      organizerSetupEnabled: account?.organizerSetupEnabled ?? false,
    });
  }

  async function handleSaveAccountSettings() {
    if (!normalizedSettings.displayName) {
      toast.error("Display name is required.");
      return;
    }

    try {
      setIsSavingSettings(true);
      const updatedAccount = await updateAccountSettings({
        displayName: normalizedSettings.displayName,
        firstName: normalizedSettings.firstName,
        lastName: normalizedSettings.lastName,
        dateOfBirth: normalizedSettings.dateOfBirth,
        gender:
          normalizedSettings.gender === "F" ||
          normalizedSettings.gender === "M" ||
          normalizedSettings.gender === "U"
            ? normalizedSettings.gender
            : null,
        city: normalizedSettings.city,
        countryCode: normalizedSettings.countryCode,
        phone: normalizedSettings.phone,
        emergencyContactName: normalizedSettings.emergencyContactName,
        emergencyContactPhone: normalizedSettings.emergencyContactPhone,
        shirtSize: normalizedSettings.shirtSize,
        mealPreference: normalizedSettings.mealPreference,
        locale: normalizedSettings.locale,
        timezone: normalizedSettings.timezone,
        avatarUrl: normalizedSettings.avatarUrl,
        coverImageUrl: normalizedSettings.coverImageUrl,
        organizerSetupEnabled: normalizedSettings.organizerSetupEnabled,
      });
      setSettingsForm({
        displayName: updatedAccount.displayName,
        firstName: updatedAccount.firstName ?? "",
        lastName: updatedAccount.lastName ?? "",
        dateOfBirth: updatedAccount.dateOfBirth ?? "",
        gender: updatedAccount.gender ?? "",
        city: updatedAccount.city ?? "",
        countryCode: updatedAccount.countryCode ?? "HR",
        phone: updatedAccount.phone ?? "",
        emergencyContactName: updatedAccount.emergencyContactName ?? "",
        emergencyContactPhone: updatedAccount.emergencyContactPhone ?? "",
        shirtSize: updatedAccount.shirtSize ?? "",
        mealPreference: updatedAccount.mealPreference ?? "",
        locale: normalizeAppLocale(updatedAccount.locale) ?? "en",
        timezone: updatedAccount.timezone,
        avatarUrl: updatedAccount.avatarUrl ?? "",
        coverImageUrl: updatedAccount.coverImageUrl ?? "",
        organizerSetupEnabled: updatedAccount.organizerSetupEnabled,
      });
      stagePublicAthleteProfileCache(queryClient, {
        slug: updatedAccount.primaryAthleteSlug,
        name: updatedAccount.displayName,
        avatarUrl: updatedAccount.avatarUrl,
        coverImageUrl: updatedAccount.coverImageUrl,
      });
      const updatedRaceProfile = getRaceProfileCompletion(updatedAccount);
      if (nextPath && updatedRaceProfile.ready) {
        toast.success("Account settings saved. Returning to registration.");
        navigate(nextPath);
        return;
      }
      toast.success("Account settings saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save account settings");
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleAvatarFile(file: File | null) {
    if (!file || !account?.userId) return;

    try {
      setIsUploadingAvatar(true);
      const avatarUrl = await uploadAccountAvatar(account.userId, file);
      setSettingsForm((current) => ({ ...current, avatarUrl }));
      toast.success("Image uploaded. Save your account settings to publish it.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload profile photo.");
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  async function handleCoverFile(file: File | null) {
    if (!file || !account?.userId) return;

    try {
      setIsUploadingCover(true);
      const coverImageUrl = await uploadAccountCoverImage(account.userId, file);
      setSettingsForm((current) => ({ ...current, coverImageUrl }));
      toast.success("Cover photo uploaded. Save your changes to publish it.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload cover photo.");
    } finally {
      setIsUploadingCover(false);
    }
  }

  async function handleDeleteAccount() {
    try {
      setIsDeletingAccount(true);
      await deleteAccount(deleteConfirmation);
      toast.success("Your account has been deleted.");
      navigate("/auth", { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete account");
    } finally {
      setIsDeletingAccount(false);
    }
  }

  async function handleResendVerification() {
    const email = account?.email ?? user?.email;
    if (!email) {
      toast.error("No email address is available for this account.");
      return;
    }

    try {
      setIsResendingVerification(true);
      await resendVerificationEmail(email);
      toast.success("Verification email sent.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to resend verification email");
    } finally {
      setIsResendingVerification(false);
    }
  }

  async function handlePasswordReset() {
    const email = account?.email ?? user?.email;
    if (!email) {
      toast.error("No email address is available for this account.");
      return;
    }

    try {
      setIsSendingPasswordReset(true);
      setPasswordResetFeedback(null);
      const result = await requestPasswordReset(email);
      if (result.rateLimited) {
        const message = t("auth.reset.accountEmailRateLimited");
        setPasswordResetFeedback({ kind: "error", message });
        toast.error(message);
        return;
      }
      const message = t("auth.reset.accountEmailSent", { email });
      setPasswordResetFeedback({ kind: "success", message });
      toast.success(message);
    } catch (error) {
      const message = formatAuthError(error, "send_email", t);
      setPasswordResetFeedback({ kind: "error", message });
      toast.error(message);
    } finally {
      setIsSendingPasswordReset(false);
    }
  }

  if (!showEditor && location.pathname === "/athlete/account") {
    return <Navigate replace to="/athlete/account?view=edit#athlete-public-profile" />;
  }

  if (!showEditor) return null;

  return (
    <div className="mx-auto w-full max-w-5xl p-3 sm:p-5 lg:p-6">
      <header className="mb-3 flex flex-col gap-2.5 sm:mb-4 sm:gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-2xl font-black tracking-tight text-foreground sm:text-3xl">
            My Account
          </h1>
          <Badge variant="outline">Athlete · {accountCompletion.percent}% complete</Badge>
          <Button asChild variant="outline" size="sm" className="h-7 rounded-full px-2.5 text-xs">
            <a href="#athlete-login-username">
              <AtSign className="h-3.5 w-3.5" />
              {account?.loginUsername ? `@${account.loginUsername}` : "Choose username"}
            </a>
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {nextPath ? (
            <Button asChild variant="outline" size="sm">
              <Link to={nextPath}>Back to registration</Link>
            </Button>
          ) : null}
          {publicProfilePath ? (
            <Button asChild variant="outline" size="sm">
              <Link to={publicProfilePath}>Public profile</Link>
            </Button>
          ) : null}
          <Button
            size="sm"
            data-testid="account-settings-save"
            disabled={isSavingSettings || !hasSettingsChanges || !normalizedSettings.displayName}
            onClick={handleSaveAccountSettings}
          >
            <Save className="h-4 w-4" />
            {isSavingSettings ? "Saving..." : hasSettingsChanges ? "Save account" : "Saved"}
          </Button>
        </div>
      </header>

      <div className="mb-4 hidden lg:block">
        <WorkspaceAccessSummary />
      </div>

      <div className="mb-4">
        <AccountTypeControl />
      </div>

      {account?.primaryAthleteProfileId ? (
        <AthleteRaceHistorySearch
          key={account.primaryAthleteProfileId}
          ownProfileId={account.primaryAthleteProfileId}
          identity={{ firstName: account.firstName ?? "", lastName: account.lastName ?? "", dateOfBirth: account.dateOfBirth ?? "" }}
        />
      ) : null}

      {account && !raceProfile.ready ? (
        <Alert variant="destructive" className="mb-3 border-destructive/35 bg-destructive/[0.06] sm:mb-4" aria-live="polite">
          <CalendarClock className="h-4 w-4" />
          <AlertTitle>{t("profile.raceReadiness.title")}</AlertTitle>
          <AlertDescription className="mt-2">
            <p>{t("profile.raceReadiness.description")}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {missingRequiredRaceFields.map((field) => (
                <li key={field.id}>
                  <a className="font-medium underline-offset-2 hover:underline" href={`#${field.id}`}>
                    {field.label}
                  </a>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <section
        id="athlete-public-profile"
        className="mb-3 overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-soft sm:mb-4 sm:rounded-[22px]"
        aria-labelledby="athlete-public-profile-heading"
      >
        <input
          ref={coverFileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          data-testid="athlete-cover-file-input"
          onChange={(event) => {
            void handleCoverFile(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />

        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-b border-border/70 px-3 py-2.5 sm:px-5 sm:py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">Profile</div>
            <div className="mt-1 flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-primary" />
              <h2 id="athlete-public-profile-heading" className="font-display text-lg font-bold text-foreground">Public profile</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <img
              src={normalizedSettings.coverImageUrl || clubRidgeImage}
              alt={normalizedSettings.coverImageUrl ? "Current profile cover" : "Default trail profile cover"}
              className="h-8 w-14 rounded-md object-cover"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isUploadingCover || !account?.userId}
              onClick={() => coverFileInputRef.current?.click()}
            >
              <Camera className="h-4 w-4" />
              {isUploadingCover ? "Uploading..." : "Change cover"}
            </Button>
            {normalizedSettings.coverImageUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSettingsForm((current) => ({ ...current, coverImageUrl: "" }))}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>

        <AthletePublicProfileLivePreview
          name={normalizedSettings.displayName || account?.displayName || user?.email || "Athlete"}
          handle={account?.primaryAthleteSlug}
          avatarUrl={previewAvatarUrl}
          coverImageUrl={normalizedSettings.coverImageUrl || clubRidgeImage}
          clubName={primaryClub?.name}
          location={profileLocation}
          ageCategory={ageCategory}
          record={publicRecord}
        />

        <div className="p-2.5 sm:p-4">
          <div className="grid gap-2.5 sm:gap-3 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
            <aside className="rounded-2xl border border-border/70 bg-background/70 p-2.5 text-center sm:p-3">
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-x-3 lg:block">
                <AccountAvatarControl
                  avatarUrl={previewAvatarUrl}
                  displayName={normalizedSettings.displayName || account?.displayName || user?.email || "Athlete"}
                  isUploading={isUploadingAvatar}
                  disabled={!account?.userId}
                  inputTestId="athlete-avatar-file-input"
                  onFileSelected={handleAvatarFile}
                  onRemove={() => setSettingsForm((current) => ({ ...current, avatarUrl: "" }))}
                />
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground sm:mt-2 sm:text-[11px]">JPG, PNG, or WebP · 5 MB max</p>

              {account?.primaryAthleteSlug ? (
                <details className="group mt-2 border-t border-border/70 pt-2 text-left sm:mt-3 sm:pt-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between rounded-md py-1 text-xs font-semibold text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    Built-in avatars
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <ProfileAvatarPicker
                    value={normalizedSettings.avatarUrl}
                    onChange={(avatarUrl) => setSettingsForm((current) => ({ ...current, avatarUrl }))}
                    className="mt-2 border-t-0 pt-0"
                  />
                </details>
              ) : null}

              <details className="group mt-2 border-t border-border/70 pt-2 text-left">
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-md py-1 text-xs font-semibold text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Custom image URL
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-2">
                  <label htmlFor="athlete-avatar-url" className="sr-only">Profile image URL</label>
                  <Input
                    id="athlete-avatar-url"
                    aria-label="Profile image URL"
                    type="url"
                    value={settingsForm.avatarUrl}
                    onChange={(event) => setSettingsForm((current) => ({ ...current, avatarUrl: event.target.value }))}
                    placeholder="https://example.com/avatar.jpg"
                  />
                </div>
              </details>
            </aside>

            <div className="min-w-0 space-y-2.5 sm:space-y-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2 sm:mb-2 sm:gap-3">
                  <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Public details</h3>
                  <span className={`text-xs font-semibold ${publicDataCompletedCount === 5 ? "text-emerald-700 dark:text-emerald-400" : "text-primary"}`}>
                    {publicDataCompletedCount} / 5 complete
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-2 sm:gap-x-2.5 sm:gap-y-2.5 xl:grid-cols-3">
            <div className="col-span-2 space-y-0.5 sm:space-y-1 xl:col-span-1">
              <label htmlFor="athlete-display-name" className="text-xs font-semibold text-foreground/80">
                Display name <span className="text-primary">*</span>
              </label>
              <Input
                id="athlete-display-name"
                value={settingsForm.displayName}
                onChange={(event) => setSettingsForm((current) => ({ ...current, displayName: event.target.value }))}
                placeholder="Your public account name"
              />
            </div>
            <div className="space-y-0.5 sm:space-y-1">
              <label htmlFor="athlete-first-name" className="text-xs font-semibold text-foreground/80">
                First name <span className="text-primary">*</span>
              </label>
              <Input
                id="athlete-first-name"
                value={settingsForm.firstName}
                onChange={(event) => setSettingsForm((current) => ({ ...current, firstName: event.target.value }))}
                placeholder="First name"
              />
            </div>
            <div className="space-y-0.5 sm:space-y-1">
              <label htmlFor="athlete-last-name" className="text-xs font-semibold text-foreground/80">
                Last name <span className="text-primary">*</span>
              </label>
              <Input
                id="athlete-last-name"
                value={settingsForm.lastName}
                onChange={(event) => setSettingsForm((current) => ({ ...current, lastName: event.target.value }))}
                placeholder="Last name"
              />
            </div>
            <div className="space-y-0.5 sm:space-y-1">
              <label htmlFor="athlete-city" className="text-xs font-semibold text-foreground/80">
                City <span className="text-primary">*</span>
              </label>
              <Input
                id="athlete-city"
                value={settingsForm.city}
                onChange={(event) => setSettingsForm((current) => ({ ...current, city: event.target.value }))}
                placeholder="Split"
              />
            </div>
            <label className="space-y-0.5 sm:space-y-1" htmlFor="athlete-country">
              <span className="text-xs font-semibold text-foreground/80">
                Country <span className="text-primary">*</span>
              </span>
              <select
                id="athlete-country"
                aria-label="Country"
                value={settingsForm.countryCode}
                onChange={(event) => setSettingsForm((current) => ({ ...current, countryCode: event.target.value }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {organizationCountryOptions.map((country) => (
                  <option key={country.value} value={country.value}>{country.label}</option>
                ))}
              </select>
            </label>
            <div className="col-span-2 space-y-0.5 sm:space-y-1 xl:col-span-1">
              <label htmlFor="athlete-profile-handle" className="text-xs font-semibold text-foreground/80">Profile handle</label>
              <Input id="athlete-profile-handle" value={account?.primaryAthleteSlug ? `@${account.primaryAthleteSlug}` : "Not claimed"} disabled />
            </div>
                </div>
              </div>

            </div>
          </div>

          <section id="athlete-race-data" className="mt-3 border-t border-border/70 pt-3 sm:mt-4 sm:pt-4">
            <div className="mb-2.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Private details</h3>
                <p className="mt-1 text-xs text-muted-foreground">Used only for race registrations and emergency support.</p>
              </div>
              <span className={`text-xs font-semibold ${privateDataCompletedCount === 5 ? "text-emerald-700 dark:text-emerald-400" : "text-primary"}`}>
                {t("profile.raceReadiness.progress", { completed: privateDataCompletedCount, total: 5 })}
              </span>
            </div>
            <div className="grid gap-x-2.5 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor="athlete-date-of-birth" className="text-xs font-semibold text-foreground/80">
                  Date of birth <span className="text-primary">*</span>
                </label>
                <Input
                  id="athlete-date-of-birth"
                  type="date"
                  value={settingsForm.dateOfBirth}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, dateOfBirth: event.target.value }))}
                  aria-invalid={!normalizedSettings.dateOfBirth || undefined}
                  className={!normalizedSettings.dateOfBirth ? "border-destructive focus-visible:ring-destructive/20" : undefined}
                />
              </div>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-foreground/80">
                  Gender <span className="text-primary">*</span>
                </span>
                <select
                  id="athlete-gender"
                  value={settingsForm.gender}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, gender: event.target.value }))}
                  aria-invalid={!normalizedSettings.gender || undefined}
                  className={`h-10 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${!normalizedSettings.gender ? "border-destructive focus-visible:ring-destructive/20" : "border-input"}`}
                >
                  <option value="">Select gender</option>
                  <option value="F">Female</option>
                  <option value="M">Male</option>
                  <option value="U">Prefer not to say / other</option>
                </select>
              </label>
              <div className="space-y-1">
                <label htmlFor="athlete-phone" className="text-xs font-semibold text-foreground/80">
                  Phone <span className="text-primary">*</span>
                </label>
                <Input
                  id="athlete-phone"
                  value={settingsForm.phone}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="+385 91 123 4567"
                  aria-invalid={!normalizedSettings.phone || undefined}
                  className={!normalizedSettings.phone ? "border-destructive focus-visible:ring-destructive/20" : undefined}
                />
              </div>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-foreground/80">
                  Shirt size <span className="font-normal text-muted-foreground">({t("common.optional")})</span>
                </span>
                <select
                  value={settingsForm.shirtSize}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, shirtSize: event.target.value }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Choose size</option>
                  {["XS", "S", "M", "L", "XL", "XXL"].map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-foreground/80">{t("athleteData.mealPreference")}</span>
                <Input value={settingsForm.mealPreference} maxLength={80}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, mealPreference: event.target.value }))}
                  placeholder={t("athleteData.mealExample")} />
                <span className="block text-xs text-muted-foreground">{t("athleteData.privatePreference")}</span>
              </label>
              <div className="space-y-1">
                <label htmlFor="athlete-emergency-name" className="text-xs font-semibold text-foreground/80">
                  Emergency contact name <span className="text-primary">*</span>
                </label>
                <Input
                  id="athlete-emergency-name"
                  value={settingsForm.emergencyContactName}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, emergencyContactName: event.target.value }))}
                  placeholder="Ana Juric"
                  aria-invalid={!normalizedSettings.emergencyContactName || undefined}
                  className={!normalizedSettings.emergencyContactName ? "border-destructive focus-visible:ring-destructive/20" : undefined}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="athlete-emergency-phone" className="text-xs font-semibold text-foreground/80">
                  Emergency contact phone <span className="text-primary">*</span>
                </label>
                <Input
                  id="athlete-emergency-phone"
                  value={settingsForm.emergencyContactPhone}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, emergencyContactPhone: event.target.value }))}
                  placeholder="+385 98 555 123"
                  aria-invalid={!normalizedSettings.emergencyContactPhone || undefined}
                  className={!normalizedSettings.emergencyContactPhone ? "border-destructive focus-visible:ring-destructive/20" : undefined}
                />
              </div>
            </div>
          </section>

          <section className="mt-4 border-t border-border/70 pt-4">
            <h3 className="mb-2.5 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("profile.accountPreferences")}</h3>
            <div id="athlete-login-username" className="mb-3 scroll-mt-4">
              <AccountUsernameControl
                username={account?.loginUsername ?? null}
                changeAvailableAt={account?.usernameChangeAvailableAt ?? null}
                canChange={Boolean(
                  account
                  && account.accountType !== "temporary"
                  && (
                    account.authProviders.includes("email")
                    || account.authProviders.length === 0
                  )
                )}
                changeDisabledReason={
                  account?.accountType === "temporary"
                    ? "This username is managed by your organization administrator."
                    : "A password sign-in method is required to choose or change a username."
                }
                onChangeUsername={changeUsername}
              />
            </div>
            <div className="grid gap-x-2.5 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.35fr)_minmax(120px,0.65fr)_minmax(140px,0.7fr)_minmax(180px,1fr)]">
              <div className="space-y-1">
                <label htmlFor="athlete-account-email" className="text-xs font-semibold text-foreground/80">Email (account)</label>
                <Input id="athlete-account-email" value={account?.email ?? user?.email ?? ""} disabled />
              </div>
              <div className="space-y-1">
                <label htmlFor="athlete-locale" className="text-xs font-semibold text-foreground/80">{t("common.language")}</label>
                <select
                  id="athlete-locale"
                  aria-describedby="athlete-locale-hint"
                  value={settingsForm.locale}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, locale: event.target.value }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="hr">{t("common.croatian")}</option>
                  <option value="en">{t("common.english")}</option>
                </select>
                <p id="athlete-locale-hint" className="text-[11px] leading-4 text-muted-foreground">{t("profile.languageHint")}</p>
              </div>
              <AccountAppearancePreference id="athlete-appearance" />
              <label className="space-y-1" htmlFor="athlete-timezone">
                <span className="text-xs font-semibold text-foreground/80">{t("profile.timezone")}</span>
                <select
                  id="athlete-timezone"
                  value={settingsForm.timezone}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, timezone: event.target.value }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="Europe/Zagreb">Europe/Zagreb</option>
                  <option value="Europe/Ljubljana">Europe/Ljubljana</option>
                  <option value="Europe/Sarajevo">Europe/Sarajevo</option>
                  <option value="Europe/Belgrade">Europe/Belgrade</option>
                </select>
              </label>
            </div>
          </section>
        </div>
      </section>

      {account && !account.email ? (
        <Alert className="mb-4 border-primary/20 bg-primary/[0.04]">
          <Shield className="h-4 w-4 text-primary" />
          <AlertTitle>Username account active</AlertTitle>
          <AlertDescription className="mt-2">
            Sign in with <span className="font-medium text-foreground">@{account.loginUsername}</span> · No recovery email connected.
          </AlertDescription>
        </Alert>
      ) : account && !account.emailVerified ? (
        <Alert className="mb-4 border-trail-amber/30 bg-trail-amber/5">
          <Shield className="h-4 w-4 text-trail-amber" />
          <AlertTitle>Email verification still pending</AlertTitle>
          <AlertDescription className="mt-2 space-y-3">
            <p>
              Verify <span className="font-medium text-foreground">{account?.email ?? user?.email ?? "your email"}</span>{" "}
              to keep your account secure and unlock organizer-sensitive actions later.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={handleResendVerification} disabled={isResendingVerification}>
                {isResendingVerification ? "Sending..." : "Resend verification email"}
              </Button>
              {authInboxUrl ? (
                <Button asChild size="sm" variant="outline">
                  <a href={authInboxUrl} target="_blank" rel="noreferrer">
                    Open local inbox
                  </a>
                </Button>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <div>
        <div className="space-y-4">
          <SectionCard
            id="athlete-clubs-access"
            eyebrow="Community"
            title="Club and organizer access"
            description="Private"
          >
            <div className="grid gap-2.5 lg:grid-cols-2">
              <div className="h-full rounded-xl border border-border/70 bg-background/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Users className="h-4 w-4 text-primary" />
                    Clubs
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Memberships connected to your athlete profile.</p>
                  </div>
                  <Button asChild size="sm" variant="ghost"><Link to="/athlete/clubs">Manage</Link></Button>
                </div>
                {clubsQuery.data.memberships.length ? (
                  <div className="mt-3 grid gap-2">
                    {clubsQuery.data.memberships.map((club) => (
                      <Link
                        key={club.clubId}
                        to={`/clubs/${club.clubSlug}`}
                        className="flex items-center gap-3 rounded-lg border border-border/70 bg-card px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-primary/[0.04]"
                      >
                        <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{club.name}</span>
                        <Badge variant="outline">{formatMembershipRole(club.role)}</Badge>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-card/70 px-3 py-2.5 text-sm text-muted-foreground">
                    <span>No active club membership.</span>
                    <Button asChild size="sm" variant="outline"><Link to="/clubs">Browse clubs</Link></Button>
                  </div>
                )}
              </div>

              <div className="h-full rounded-xl border border-border/70 bg-background/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Building2 className="h-4 w-4 text-primary" />
                    Organizations
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Organizer workspaces available to this account.</p>
                  </div>
                  {account?.hasOrganizerAccess ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/organizer/dashboard">Open workspace</Link>
                    </Button>
                  ) : null}
                </div>
                {organizationAccess.length ? (
                  <div className="mt-3 grid gap-2">
                    {organizationAccess.map((membership) => (
                      <div
                        key={`${membership.organizationId}-${membership.role}`}
                        className="flex items-center gap-3 rounded-lg border border-border/70 bg-card px-3 py-2.5"
                      >
                        <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
                          {membership.organizationName}
                        </span>
                        <Badge variant="outline">{formatMembershipRole(membership.role)}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-border bg-card/70 px-3 py-2.5 text-sm text-muted-foreground">No organization access.</div>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            id="athlete-security"
            eyebrow="Login"
            title="Account access"
            description="Private"
          >
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                <AccountEmailControl
                  currentEmail={account?.email ?? user?.email ?? null}
                  pendingEmail={user?.new_email ?? null}
                  emailVerified={account?.emailVerified ?? Boolean(user?.email_confirmed_at)}
                  canChange={Boolean(account && isPasswordAccount)}
                  confirmationPath="/athlete/account?view=edit#athlete-security"
                  controlId="athlete-account-email-change"
                  onChangeEmail={changeEmail}
                />

                <div className="h-full rounded-xl border border-border/70 bg-background/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm text-foreground">
                      <Shield className="h-4 w-4 text-primary" />
                      <span className="font-medium">Verification</span>
                    </div>
                    <Badge variant={account?.emailVerified ? "default" : "secondary"}>
                      {account?.emailVerified
                        ? "Verified"
                        : account?.email
                          ? "Pending"
                          : "Username account"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {account?.emailVerified
                      ? "Your email is verified."
                      : account?.email
                        ? "Verify your email to unlock protected actions."
                        : "This account signs in with a username."}
                  </p>
                  {account?.email && !account.emailVerified ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" onClick={handleResendVerification} disabled={isResendingVerification}>
                        {isResendingVerification ? "Sending..." : "Resend verification"}
                      </Button>
                      {authInboxUrl ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={authInboxUrl} target="_blank" rel="noreferrer">
                            Open local inbox
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              <div className="h-full rounded-xl border border-border/70 bg-background/70 p-3">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <KeyRound className="h-4 w-4 text-primary" />
                  <span className="font-medium">Password recovery</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {account?.email && account.emailVerified
                    ? t("auth.reset.accountRecoveryDescription")
                    : account?.email
                      ? t("auth.reset.accountRecoveryVerifyDescription")
                    : t("auth.reset.accountRecoveryAddDescription")}
                </p>
                {passwordResetFeedback ? (
                  <Alert
                    className="mt-3"
                    variant={passwordResetFeedback.kind === "error" ? "destructive" : "default"}
                    role={passwordResetFeedback.kind === "error" ? "alert" : "status"}
                  >
                    <AlertTitle>
                      {passwordResetFeedback.kind === "error"
                        ? t("auth.reset.accountRecoveryBlockedTitle")
                        : t("auth.reset.accountRecoveryRequestedTitle")}
                    </AlertTitle>
                    <AlertDescription>{passwordResetFeedback.message}</AlertDescription>
                  </Alert>
                ) : null}
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={handlePasswordReset}
                  disabled={isSendingPasswordReset || !account?.email || !account.emailVerified}
                >
                  {isSendingPasswordReset ? "Sending..." : "Send reset email"}
                </Button>
                <div className="mt-3 border-t border-border/70 pt-3 text-sm">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    Sign-in methods
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{authProviderLabel}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(account?.authProviders ?? []).map((provider) => (
                      <Badge key={provider} variant="outline">
                        {formatProviderLabel(provider)}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

          <details className="group self-start rounded-[22px] border border-destructive/20 bg-card/95 shadow-soft">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[22px] p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-destructive">Account</div>
                <h2 className="mt-1 font-display text-lg font-bold text-foreground">Delete account</h2>
              </div>
              <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-destructive/15 p-4 sm:p-5">
            <div className="rounded-lg border border-destructive/20 bg-destructive/[0.035] p-4">
              <div className="flex items-start gap-3">
                <Trash2 className="mt-0.5 h-4 w-4 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-6 text-muted-foreground">
                    Registrations, results, and race history remain attached to the athlete profile so public race records stay intact.
                  </p>

                  {hasDeletionBlocker ? (
                    <p className="mt-4 text-sm font-medium text-destructive">
                      Transfer owner/admin access in your organization workspaces before deleting this account.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <CalendarClock className="h-4 w-4 text-destructive" />
                        <span>
                          Type <span className="font-mono">{deleteConfirmationTarget}</span> to confirm.
                        </span>
                      </div>
                      <Input
                        aria-label="Account deletion confirmation"
                        value={deleteConfirmation}
                        onChange={(event) => setDeleteConfirmation(event.target.value)}
                        placeholder={deleteConfirmationTarget}
                        autoComplete="off"
                      />
                      <Button
                        variant="destructive"
                        className="w-full sm:w-auto"
                        disabled={
                          isDeletingAccount ||
                          deleteConfirmation.trim().toLowerCase() !== deleteConfirmationTarget.toLowerCase()
                        }
                        onClick={handleDeleteAccount}
                      >
                        {isDeletingAccount ? "Deleting account..." : "Delete account"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            </div>
          </details>
        </div>

      </div>

      {hasSettingsChanges ? (
        <div className="sticky bottom-4 z-20 mt-6 rounded-[22px] border border-primary/20 bg-card/95 p-3 shadow-soft backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Save className="h-4 w-4" />
              </span>
              <div>
                <div className="font-medium text-foreground">
                  {pendingChangeCount} unsaved change{pendingChangeCount === 1 ? "" : "s"}
                </div>
                <div className="text-xs text-muted-foreground">Save before leaving this page.</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={isSavingSettings} onClick={resetAccountSettings}>
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
              <Button size="sm" disabled={isSavingSettings || !normalizedSettings.displayName} onClick={handleSaveAccountSettings}>
                <Save className="h-4 w-4" />
                {isSavingSettings ? "Saving..." : "Save account"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
