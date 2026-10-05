import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Facebook,
  Globe2,
  Instagram,
  KeyRound,
  Linkedin,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  Save,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { uploadAccountAvatar } from "@/lib/account-avatar";
import { formatProviderLabel } from "@/lib/account-presentation";
import { useAuth, type AuthAccountContext } from "@/lib/auth";
import { AccountAvatarControl } from "@/features/accounts/components/AccountAvatarControl";
import { AccountAppearancePreference } from "@/features/accounts/components/AccountAppearancePreference";
import { AccountEmailControl } from "@/features/accounts/components/AccountEmailControl";
import { AccountTypeControl } from "@/features/accounts/components/AccountTypeControl";
import { AccountUsernameControl } from "@/features/accounts/components/AccountUsernameControl";
import { formatAuthError } from "@/features/accounts/model/authErrorMessages";
import { organizationCountryOptions } from "@/features/accounts/model/organizationLocation";
import { WorkspaceAccessSummary } from "@/shared/navigation/WorkspaceAccessSummary";
import { ProfileAvatarPicker } from "@/features/accounts/components/ProfileAvatarPicker";
import { stagePublicAthleteProfileCache } from "@/features/athletes/data/publicAthleteProfileCache";
import { getSibenikTrailLeagueDisplayName } from "@/shared/domain/sibenikTrailLeagueIdentity";
import { useI18n } from "@/shared/i18n/I18nContext";
import { normalizeAppLocale } from "@/shared/i18n/locales";

type AccountFormState = {
  displayName: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  jobTitle: string;
  city: string;
  countryCode: string;
  bio: string;
  locale: string;
  timezone: string;
  avatarUrl: string;
  websiteUrl: string;
  instagramUrl: string;
  facebookUrl: string;
  linkedinUrl: string;
  youtubeUrl: string;
  tiktokUrl: string;
  xUrl: string;
};

type SocialFieldKey =
  | "websiteUrl"
  | "instagramUrl"
  | "facebookUrl"
  | "linkedinUrl"
  | "youtubeUrl"
  | "tiktokUrl"
  | "xUrl";

const socialFields: Array<{
  key: SocialFieldKey;
  label: string;
  placeholder: string;
  icon: typeof Globe2;
}> = [
  { key: "websiteUrl", label: "Website", placeholder: "https://your-site.com", icon: Globe2 },
  { key: "instagramUrl", label: "Instagram", placeholder: "https://instagram.com/yourname", icon: Instagram },
  { key: "facebookUrl", label: "Facebook", placeholder: "https://facebook.com/yourname", icon: Facebook },
  { key: "linkedinUrl", label: "LinkedIn", placeholder: "https://linkedin.com/in/yourname", icon: Linkedin },
  { key: "youtubeUrl", label: "YouTube", placeholder: "https://youtube.com/@yourchannel", icon: Youtube },
  { key: "tiktokUrl", label: "TikTok", placeholder: "https://tiktok.com/@yourname", icon: AtSign },
  { key: "xUrl", label: "X", placeholder: "https://x.com/yourname", icon: AtSign },
];

const emptyAccountForm: AccountFormState = {
  displayName: "",
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  phone: "",
  jobTitle: "",
  city: "",
  countryCode: "HR",
  bio: "",
  locale: "en",
  timezone: "Europe/Zagreb",
  avatarUrl: "",
  websiteUrl: "",
  instagramUrl: "",
  facebookUrl: "",
  linkedinUrl: "",
  youtubeUrl: "",
  tiktokUrl: "",
  xUrl: "",
};

function accountFormFromContext(account: AuthAccountContext | null): AccountFormState {
  if (!account) return emptyAccountForm;
  return {
    displayName: account.displayName ?? "",
    firstName: account.firstName ?? "",
    lastName: account.lastName ?? "",
    dateOfBirth: account.dateOfBirth ?? "",
    phone: account.phone ?? "",
    jobTitle: account.jobTitle ?? "",
    city: account.city ?? "",
    countryCode: account.countryCode ?? "HR",
    bio: account.bio ?? "",
    locale: normalizeAppLocale(account.locale) ?? "en",
    timezone: account.timezone ?? "Europe/Zagreb",
    avatarUrl: account.avatarUrl ?? "",
    websiteUrl: account.websiteUrl ?? "",
    instagramUrl: account.instagramUrl ?? "",
    facebookUrl: account.facebookUrl ?? "",
    linkedinUrl: account.linkedinUrl ?? "",
    youtubeUrl: account.youtubeUrl ?? "",
    tiktokUrl: account.tiktokUrl ?? "",
    xUrl: account.xUrl ?? "",
  };
}

function normalizedAccountForm(form: AccountFormState): AccountFormState {
  return {
    displayName: form.displayName.trim(),
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    dateOfBirth: form.dateOfBirth.trim(),
    phone: form.phone.trim(),
    jobTitle: form.jobTitle.trim(),
    city: form.city.trim(),
    countryCode: form.countryCode.trim().toUpperCase(),
    bio: form.bio.trim(),
    locale: form.locale.trim(),
    timezone: form.timezone.trim(),
    avatarUrl: form.avatarUrl.trim(),
    websiteUrl: form.websiteUrl.trim(),
    instagramUrl: form.instagramUrl.trim(),
    facebookUrl: form.facebookUrl.trim(),
    linkedinUrl: form.linkedinUrl.trim(),
    youtubeUrl: form.youtubeUrl.trim(),
    tiktokUrl: form.tiktokUrl.trim(),
    xUrl: form.xUrl.trim(),
  };
}

function isHttpUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function SectionCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[22px] border border-border/70 bg-card/95 p-4 shadow-soft sm:p-5">
      <div className="mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
          {eyebrow}
        </div>
        <h2 className="mt-1 font-display text-lg font-bold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function FormField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-semibold text-foreground/80">{label}</Label>
      {children}
      {hint ? <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function OrganizerAccountPage() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const {
    user,
    account,
    updateAccountSettings,
    changeEmail,
    changePassword,
    changeUsername,
    requestPasswordReset,
  } = useAuth();
  const [form, setForm] = useState<AccountFormState>(emptyAccountForm);
  const [activeDetailsTab, setActiveDetailsTab] = useState("profile");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [passwordResetFeedback, setPasswordResetFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  useEffect(() => {
    setForm(accountFormFromContext(account));
  }, [account]);

  const normalizedForm = useMemo(() => normalizedAccountForm(form), [form]);
  const savedForm = useMemo(() => normalizedAccountForm(accountFormFromContext(account)), [account]);
  const hasChanges = JSON.stringify(normalizedForm) !== JSON.stringify(savedForm);
  const invalidSocialField = socialFields.find(
    (field) => !isHttpUrl(normalizedForm[field.key]),
  );
  const organizationNames = account?.organizationNames ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const isPasswordAccount = (account?.authProviders ?? []).includes("email")
    || (account?.authProviders ?? []).length === 0;

  if (account?.accountType === "temporary") {
    return <Navigate to="/organizer/race-operations?phase=race" replace />;
  }

  function updateForm<Key extends keyof AccountFormState>(
    key: Key,
    value: AccountFormState[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetForm() {
    setForm(accountFormFromContext(account));
    toast.message("Unsaved account changes were reset.");
  }

  async function saveAccount() {
    if (!normalizedForm.displayName) {
      toast.error("Display name is required.");
      setActiveDetailsTab("profile");
      requestAnimationFrame(() => document.getElementById("organizer-display-name")?.focus());
      return;
    }
    if (normalizedForm.countryCode && !/^[A-Z]{2}$/.test(normalizedForm.countryCode)) {
      toast.error("Choose a valid country.");
      setActiveDetailsTab("profile");
      requestAnimationFrame(() => document.getElementById("organizer-country")?.focus());
      return;
    }
    if (invalidSocialField) {
      toast.error(`${invalidSocialField.label} needs a complete http or https URL.`);
      setActiveDetailsTab("links");
      requestAnimationFrame(() => document.getElementById(`organizer-${invalidSocialField.key}`)?.focus());
      return;
    }

    try {
      setIsSaving(true);
      const updatedAccount = await updateAccountSettings({
        ...normalizedForm,
        gender: account?.gender ?? null,
        emergencyContactName: account?.emergencyContactName ?? "",
        emergencyContactPhone: account?.emergencyContactPhone ?? "",
        shirtSize: account?.shirtSize ?? "",
        organizerSetupEnabled: account?.organizerSetupEnabled ?? true,
      });
      stagePublicAthleteProfileCache(queryClient, {
        slug: updatedAccount.primaryAthleteSlug,
        name: updatedAccount.displayName,
        avatarUrl: updatedAccount.avatarUrl,
        coverImageUrl: updatedAccount.coverImageUrl,
      });
      toast.success("Organizer account saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save organizer account.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAvatarFile(file: File | null) {
    if (!file || !account?.userId) return;
    try {
      setIsUploadingAvatar(true);
      const avatarUrl = await uploadAccountAvatar(account.userId, file);
      updateForm("avatarUrl", avatarUrl);
      toast.success("Image uploaded. Save your account to publish it.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload profile photo.");
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  async function handlePasswordChange() {
    if (!passwordForm.currentPassword) {
      toast.error("Enter your current password.");
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      toast.error("Use at least 8 characters for the new password.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error("The new passwords do not match.");
      return;
    }
    if (passwordForm.currentPassword === passwordForm.newPassword) {
      toast.error("Choose a new password that is different from the current password.");
      return;
    }

    try {
      setIsChangingPassword(true);
      await changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast.success("Password changed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to change password.");
    } finally {
      setIsChangingPassword(false);
    }
  }

  async function sendPasswordReset() {
    const email = account?.email ?? user?.email;
    if (!email) {
      toast.error("No email is available for this account.");
      return;
    }
    try {
      setIsSendingReset(true);
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
      setIsSendingReset(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-5 lg:p-6">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl font-black tracking-tight text-foreground sm:text-3xl">
              My Account
            </h1>
            <Badge variant="outline">
              {account?.isMasterAdmin
                ? "Master admin"
                : account?.accountType === "owner"
                  ? "Organization owner"
                  : "Organizer"}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {hasChanges ? (
            <Button variant="outline" onClick={resetForm} disabled={isSaving}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          ) : null}
          <Button
            data-testid="organizer-account-save"
            onClick={saveAccount}
            disabled={isSaving || !hasChanges}
          >
            <Save className="h-4 w-4" />
            {isSaving ? "Saving..." : hasChanges ? "Save account" : "Saved"}
          </Button>
        </div>
      </header>

      <div className="mb-4 space-y-2.5">
        <AccountTypeControl />
        <WorkspaceAccessSummary />
      </div>

      <div className="space-y-4">
        <div className="space-y-4">
          <SectionCard
            eyebrow="Profile"
            title="Account information"
          >
            <Tabs value={activeDetailsTab} onValueChange={setActiveDetailsTab}>
              <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl border border-border/70 bg-background/60 p-1 sm:w-[320px]">
                <TabsTrigger value="profile" className="min-h-9 rounded-lg">Profile</TabsTrigger>
                <TabsTrigger value="links" className="min-h-9 rounded-lg">Public links</TabsTrigger>
              </TabsList>

              <TabsContent value="profile" className="mt-4 space-y-5">
                <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]">
              <div className="rounded-2xl border border-border/70 bg-background/70 p-3 text-center">
                <AccountAvatarControl
                  avatarUrl={normalizedForm.avatarUrl}
                  displayName={normalizedForm.displayName || account?.email || "Organizer"}
                  isUploading={isUploadingAvatar}
                  disabled={!account?.userId}
                  inputTestId="organizer-avatar-file-input"
                  onFileSelected={handleAvatarFile}
                  onRemove={() => updateForm("avatarUrl", "")}
                />
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                  JPG, PNG, or WebP · 5 MB max
                </p>
                {account?.primaryAthleteSlug ? (
                  <details className="group mt-3 border-t border-border/70 pt-3 text-left">
                    <summary className="flex cursor-pointer list-none items-center justify-between rounded-md py-1 text-xs font-semibold text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Built-in avatars
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <ProfileAvatarPicker
                      value={normalizedForm.avatarUrl}
                      onChange={(avatarUrl) => updateForm("avatarUrl", avatarUrl)}
                      className="mt-2 border-t-0 pt-0"
                    />
                  </details>
                ) : null}
              </div>

              <div className="grid content-start gap-x-3 gap-y-3 sm:grid-cols-2">
                <FormField id="organizer-display-name" label="Display name">
                  <Input
                    id="organizer-display-name"
                    value={form.displayName}
                    onChange={(event) => updateForm("displayName", event.target.value)}
                    placeholder="Ivana Velebit"
                  />
                </FormField>
                <FormField id="organizer-job-title" label="Organizer title">
                  <Input
                    id="organizer-job-title"
                    value={form.jobTitle}
                    onChange={(event) => updateForm("jobTitle", event.target.value)}
                    placeholder="Race director"
                  />
                </FormField>
                <FormField id="organizer-first-name" label="First name">
                  <Input
                    id="organizer-first-name"
                    value={form.firstName}
                    onChange={(event) => updateForm("firstName", event.target.value)}
                    autoComplete="given-name"
                  />
                </FormField>
                <FormField id="organizer-last-name" label="Last name">
                  <Input
                    id="organizer-last-name"
                    value={form.lastName}
                    onChange={(event) => updateForm("lastName", event.target.value)}
                    autoComplete="family-name"
                  />
                </FormField>
                <div className="sm:col-span-2">
                  <FormField
                    id="organizer-bio"
                    label="Short organizer bio"
                    hint={`${normalizedForm.bio.length}/1200 characters`}
                  >
                    <Textarea
                      id="organizer-bio"
                      value={form.bio}
                      maxLength={1200}
                      className="min-h-20 resize-y"
                      onChange={(event) => updateForm("bio", event.target.value)}
                      placeholder="Race director, mountain guide, and volunteer coordinator..."
                    />
                  </FormField>
                </div>
              </div>
                </div>

                <div className="border-t border-border/70 pt-5">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    Private details
                  </h3>
                  <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <FormField id="organizer-date-of-birth" label="Date of birth">
                <div className="relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="organizer-date-of-birth"
                    type="date"
                    max={today}
                    value={form.dateOfBirth}
                    className="pl-10"
                    onChange={(event) => updateForm("dateOfBirth", event.target.value)}
                  />
                </div>
              </FormField>
              <FormField id="organizer-phone" label="Phone">
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="organizer-phone"
                    type="tel"
                    autoComplete="tel"
                    value={form.phone}
                    className="pl-10"
                    onChange={(event) => updateForm("phone", event.target.value)}
                    placeholder="+385 91 555 0123"
                  />
                </div>
              </FormField>
              <FormField id="organizer-city" label="City">
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="organizer-city"
                    value={form.city}
                    className="pl-10"
                    onChange={(event) => updateForm("city", event.target.value)}
                    placeholder="Zagreb"
                  />
                </div>
              </FormField>
              <FormField id="organizer-country" label="Country">
                <select
                  id="organizer-country"
                  value={form.countryCode || "HR"}
                  onChange={(event) => updateForm("countryCode", event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {organizationCountryOptions.map((country) => (
                    <option key={country.value} value={country.value}>
                      {country.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="organizer-timezone" label="Timezone">
                <Input
                  id="organizer-timezone"
                  value={form.timezone}
                  onChange={(event) => updateForm("timezone", event.target.value)}
                  placeholder="Europe/Zagreb"
                />
              </FormField>
              <FormField
                id="organizer-locale"
                label={t("common.language")}
                hint={t("profile.languageHint")}
              >
                <select
                  id="organizer-locale"
                  value={form.locale}
                  onChange={(event) => updateForm("locale", event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="hr">{t("common.croatian")}</option>
                  <option value="en">{t("common.english")}</option>
                </select>
              </FormField>
              <AccountAppearancePreference id="organizer-appearance" />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="links" className="mt-4">
                <div className="grid gap-x-3 gap-y-3 md:grid-cols-2">
              {socialFields.map((field) => {
                const Icon = field.icon;
                const isInvalid = !isHttpUrl(normalizedForm[field.key]);
                return (
                  <FormField
                    key={field.key}
                    id={`organizer-${field.key}`}
                    label={field.label}
                    hint={isInvalid ? "Use a complete http or https URL." : undefined}
                  >
                    <div className="relative">
                      <Icon className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id={`organizer-${field.key}`}
                        type="url"
                        value={form[field.key]}
                        className={`pl-10 ${isInvalid ? "border-destructive focus-visible:ring-destructive" : ""}`}
                        onChange={(event) => updateForm(field.key, event.target.value)}
                        placeholder={field.placeholder}
                      />
                    </div>
                  </FormField>
                );
              })}
                </div>
              </TabsContent>
            </Tabs>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              eyebrow="Login"
              title="Account access"
            >
              <div className="space-y-2.5">
                <AccountUsernameControl
                  username={account?.loginUsername ?? null}
                  changeAvailableAt={account?.usernameChangeAvailableAt ?? null}
                  canChange={Boolean(account && isPasswordAccount)}
                  changeDisabledReason="A password sign-in method is required to choose or change a username."
                  onChangeUsername={changeUsername}
                />
                <AccountEmailControl
                  currentEmail={account?.email ?? user?.email ?? null}
                  pendingEmail={user?.new_email ?? null}
                  emailVerified={account?.emailVerified ?? Boolean(user?.email_confirmed_at)}
                  canChange={Boolean(account && isPasswordAccount)}
                  confirmationPath="/organizer/account"
                  controlId="organizer-account-email"
                  onChangeEmail={changeEmail}
                />

                <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Building2 className="h-4 w-4 text-primary" />
                    Organization access
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {organizationNames.map((organizationName) => (
                      <Badge key={organizationName} variant="outline">
                        {getSibenikTrailLeagueDisplayName(organizationName)}
                      </Badge>
                    ))}
                    {!organizationNames.length ? (
                      <span className="text-xs text-muted-foreground">No permanent organization membership.</span>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    Sign-in methods
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(account?.authProviders?.length ? account.authProviders : ["email"]).map((provider) => (
                      <Badge key={provider} variant="outline">{formatProviderLabel(provider)}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>

            <details className="group self-start rounded-[22px] border border-border/70 bg-card/95 shadow-soft">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[22px] p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">Security</div>
                  <h2 className="mt-1 font-display text-lg font-bold text-foreground">Password and recovery</h2>
                </div>
                <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-border/70 p-4 sm:p-5">
              {isPasswordAccount ? (
                <div className="space-y-4">
                  <FormField id="current-password" label="Current password">
                    <div className="relative">
                      <Input
                        id="current-password"
                        type={showPasswords ? "text" : "password"}
                        autoComplete="current-password"
                        value={passwordForm.currentPassword}
                        className="pr-11"
                        onChange={(event) =>
                          setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-2.5 rounded p-1 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPasswords((current) => !current)}
                        aria-label={showPasswords ? "Hide passwords" : "Show passwords"}
                      >
                        {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormField>
                  <FormField id="new-password" label="New password" hint="Use at least 8 characters.">
                    <Input
                      id="new-password"
                      type={showPasswords ? "text" : "password"}
                      autoComplete="new-password"
                      value={passwordForm.newPassword}
                      onChange={(event) =>
                        setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))
                      }
                    />
                  </FormField>
                  <FormField id="confirm-password" label="Confirm new password">
                    <Input
                      id="confirm-password"
                      type={showPasswords ? "text" : "password"}
                      autoComplete="new-password"
                      value={passwordForm.confirmPassword}
                      onChange={(event) =>
                        setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))
                      }
                    />
                  </FormField>
                  <Button className="w-full" onClick={handlePasswordChange} disabled={isChangingPassword}>
                    <KeyRound className="h-4 w-4" />
                    {isChangingPassword ? "Changing password..." : "Change password"}
                  </Button>
                </div>
              ) : (
                <div className="rounded-[20px] border border-border/70 bg-background/70 p-4 text-sm leading-6 text-muted-foreground">
                  This account signs in through {account?.authProviders.map(formatProviderLabel).join(", ")}.
                  Manage that password with the connected provider.
                </div>
              )}

              <div className="my-4 flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                Recovery
                <span className="h-px flex-1 bg-border" />
              </div>

              <p className="mb-4 text-xs leading-5 text-muted-foreground">
                {account?.email && account.emailVerified
                  ? t("auth.reset.accountRecoveryDescription")
                  : account?.email
                    ? t("auth.reset.accountRecoveryVerifyDescription")
                    : t("auth.reset.accountRecoveryAddDescription")}
              </p>

              {passwordResetFeedback ? (
                <Alert
                  className="mb-4"
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
                variant="outline"
                className="w-full"
                onClick={sendPasswordReset}
                disabled={isSendingReset || !account?.email || !account.emailVerified}
              >
                <Mail className="h-4 w-4" />
                {isSendingReset ? "Sending reset email..." : "Send password reset email"}
              </Button>
              </div>
            </details>
          </div>
        </div>
      </div>

      {hasChanges ? (
        <div className="sticky bottom-4 z-20 mt-6 rounded-[22px] border border-primary/20 bg-card/95 p-3 shadow-soft backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Save className="h-4 w-4" />
              </span>
              <div>
                <div className="font-medium text-foreground">You have unsaved account changes</div>
                <div className="text-xs text-muted-foreground">Save before leaving this page.</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={resetForm} disabled={isSaving}>
                Reset
              </Button>
              <Button
                data-testid="organizer-account-save-sticky"
                size="sm"
                onClick={saveAccount}
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save account"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
