import PodiumHeader from "@/features/rewards/components/PodiumHeader";
import podiumAccess from "@/features/rewards/components/PodiumAccess.module.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  CheckCircle,
  ChevronLeft,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Timer,
  Trophy,
  User,
  UserRound,
  Users,
} from "lucide-react";
import heroImgAsset from "@/assets/hero-biokovo.jpg";
import { toast } from "sonner";
import { publicEnv } from "@/lib/public-env";
import { useAuth, type AppRole } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH, validatePasswordStrength } from "@/lib/auth-security";
import { sanitizeLocalAppPath } from "@/lib/navigation";
import { staticAssetUrl } from "@/lib/static-asset";
import { BrandWordmark } from "@/shared/brand/BrandWordmark";
import { completeAthleteProfileEmailClaim } from "@/features/accounts/data/identityGovernance";
import { ExistingAccountSignUpWarning } from "@/features/accounts/components/ExistingAccountSignUpWarning";
import { EmailVerificationPending } from "@/features/accounts/components/EmailVerificationPending";
import ThemeToggle from "@/components/shared/ThemeToggle";
import { isExistingAccountSignUpError } from "@/features/accounts/model/accountSignUpIntegrity";
import { formatAuthError } from "@/features/accounts/model/authErrorMessages";
import { useI18n } from "@/shared/i18n/I18nContext";

const heroImg = staticAssetUrl(heroImgAsset);
const isPodium = Boolean(publicEnv.rewardDemo);
const localPodium = publicEnv.rewardDemo?.mode === "local" || publicEnv.rewardDemo?.mode === "local-testnet";

type AuthTab = "login" | "signup";
type Role = Extract<AppRole, "athlete" | "organizer">;
type SignupAccountType = "athlete" | "athlete-organizer" | "organizer";

const inputClasses =
  "w-full rounded-xl border border-input bg-raised/85 px-4 py-3 pl-11 text-sm text-foreground shadow-[inset_0_1px_0_hsl(var(--foreground)/0.025)] placeholder:text-muted-foreground transition-[background-color,border-color,box-shadow] hover:border-foreground/25 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25";

function rolesForAccountType(accountType: SignupAccountType): Role[] {
  if (accountType === "organizer") return ["organizer"];
  if (accountType === "athlete-organizer") return ["athlete", "organizer"];
  return ["athlete"];
}

export default function AuthPage() {
  const { locale, t } = useI18n();
  const heroTitle = t(isPodium ? "podium.auth.heroTitle" : "auth.hero.title");
  const signupLabel = t(isPodium ? "podium.auth.createSponsor" : "auth.signUp");
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<AuthTab>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<"credentials" | "roles" | "verify">("credentials");
  const [signupAccountType, setSignupAccountType] = useState<SignupAccountType>("athlete");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPasswordValidation, setShowPasswordValidation] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [hasExistingAccountWarning, setHasExistingAccountWarning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [pendingSignUp, setPendingSignUp] = useState<{ userId: string; cancelToken: string } | null>(null);
  const credentialsHeadingRef = useRef<HTMLHeadingElement>(null);
  const rolesHeadingRef = useRef<HTMLHeadingElement>(null);
  const loginIdentifierInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<AuthTab, HTMLButtonElement | null>>({ login: null, signup: null });
  const tabFocusIntentRef = useRef<AuthTab | null>(null);
  const stepFocusIntentRef = useRef<"credentials" | "roles" | null>(null);
  const claimCompletionStartedRef = useRef(false);
  const signupFinalizationStartedRef = useRef(false);
  const navigate = useNavigate();
  const {
    account,
    hasSupabase,
    isLoading,
    cancelPendingSignUp,
    checkSignUpAvailability,
    finalizePendingSignUp,
    resendVerificationEmail,
    signIn,
    signUp,
    getDefaultRoute,
    refreshAccountContext,
    user,
  } = useAuth();
  const nextPath = useMemo(
    () => sanitizeLocalAppPath(searchParams.get("next"), { blockedPathnames: ["/auth"] }),
    [searchParams],
  );
  const emailClaimAthleteSlug = useMemo(() => {
    if (isPodium) return null;
    const value = searchParams.get("claim")?.trim() ?? "";
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : null;
  }, [searchParams]);

  useEffect(() => {
    const mode = searchParams.get("mode");
    const suggestedEmail = searchParams.get("email")?.trim() ?? "";
    if (suggestedEmail) {
      setEmail((current) => current || suggestedEmail);
      setLoginIdentifier((current) => current || suggestedEmail);
    }
    if (mode === "signup") {
      setTab("signup");
      return;
    }
    if (mode === "login") {
      setTab("login");
    }
  }, [searchParams]);

  const resolvePostAuthRoute = useCallback((nextAccount: typeof account) => {
    if (isPodium && tab === "signup") return nextPath && /^\/rewards(?:[/?#]|$)/.test(nextPath) ? nextPath : "/rewards";
    return nextPath ?? (tab === "signup" && nextAccount?.hasAthleteAccess
      ? "/athlete/account?view=edit#athlete-race-history"
      : getDefaultRoute(nextAccount));
  }, [getDefaultRoute, nextPath, tab]);

  const hasPendingVerifiedSignup = user?.user_metadata?.raceson_signup_pending === true;
  const authenticatedUserId = user?.id ?? null;

  useEffect(() => {
    if (isLoading || !authenticatedUserId || !account || emailClaimAthleteSlug || hasPendingVerifiedSignup) return;
    navigate(resolvePostAuthRoute(account), { replace: true });
  }, [account, authenticatedUserId, emailClaimAthleteSlug, hasPendingVerifiedSignup, isLoading, navigate, resolvePostAuthRoute]);

  useEffect(() => {
    if (
      isLoading
      || !authenticatedUserId
      || !account
      || !hasPendingVerifiedSignup
      || signupFinalizationStartedRef.current
    ) return;

    signupFinalizationStartedRef.current = true;
    setIsSubmitting(true);
    setFormError(null);
    void finalizePendingSignUp()
      .then((result) => {
        toast.success(result.claimRequested ? t("auth.toast.claimSent") : t("auth.toast.created"));
        navigate(resolvePostAuthRoute(result.account), { replace: true });
      })
      .catch((error) => {
        signupFinalizationStartedRef.current = false;
        const message = formatAuthError(error, "sign_up", t);
        setFormError(message);
        toast.error(message);
      })
      .finally(() => setIsSubmitting(false));
  }, [account, authenticatedUserId, finalizePendingSignUp, hasPendingVerifiedSignup, isLoading, locale, navigate, resolvePostAuthRoute, t]);

  useEffect(() => {
    if (
      isLoading
      || !authenticatedUserId
      || !account
      || !emailClaimAthleteSlug
      || claimCompletionStartedRef.current
    ) return;

    claimCompletionStartedRef.current = true;
    setIsSubmitting(true);
    void completeAthleteProfileEmailClaim(emailClaimAthleteSlug)
      .then(async (result) => {
        await refreshAccountContext();
        toast.success(t("auth.toast.claimVerified"));
        navigate(`/athletes/${encodeURIComponent(result.claim.athleteSlug)}?claimed=1`, { replace: true });
      })
      .catch((error) => {
        toast.error(locale === "en" && error instanceof Error ? error.message : t("auth.toast.claimError"));
        navigate(`/athletes/${encodeURIComponent(emailClaimAthleteSlug)}?claim=error`, { replace: true });
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  }, [account, authenticatedUserId, emailClaimAthleteSlug, isLoading, locale, navigate, refreshAccountContext, t]);

  const passwordValidationMessage =
    tab === "signup" && password.length > 0 ? validatePasswordStrength(password) : null;
  const localizedPasswordValidationMessage = passwordValidationMessage
    ? password.length < MIN_PASSWORD_LENGTH
      ? t("auth.passwordHint", { count: MIN_PASSWORD_LENGTH })
      : t("auth.passwordMax", { count: 72 })
    : null;
  const hasPasswordValidationError =
    tab === "signup" && showPasswordValidation && Boolean(localizedPasswordValidationMessage);

  useLayoutEffect(() => {
    if (stepFocusIntentRef.current !== step) return;
    const target = step === "roles" ? rolesHeadingRef.current : credentialsHeadingRef.current;
    if (!target) return;
    stepFocusIntentRef.current = null;
    target.focus();
  }, [step]);

  useLayoutEffect(() => {
    if (tabFocusIntentRef.current !== tab) return;
    tabFocusIntentRef.current = null;
    tabRefs.current[tab]?.focus();
  }, [tab]);

  const moveToStep = (nextStep: "credentials" | "roles") => {
    stepFocusIntentRef.current = nextStep;
    setStep(nextStep);
  };

  const selectTab = (nextTab: AuthTab, focusTab = false) => {
    if (isPodium && nextTab === "signup") return;
    if (focusTab) tabFocusIntentRef.current = nextTab;
    if (nextTab === tab) {
      if (focusTab) {
        tabFocusIntentRef.current = null;
        tabRefs.current[nextTab]?.focus();
      }
      return;
    }
    setPassword("");
    setShowPassword(false);
    setShowPasswordValidation(false);
    setFormError(null);
    setHasExistingAccountWarning(false);
    setStep("credentials");
    setTab(nextTab);
  };

  const showLoginForExistingAccount = () => {
    setLoginIdentifier(email.trim() || username.trim());
    setPassword("");
    setFormError(null);
    setHasExistingAccountWarning(false);
    setStep("credentials");
    selectTab("login");
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPodium && tab === "signup") return;
    if (!hasSupabase) {
      const message = t("auth.error.configuration");
      setFormError(message);
      toast.error(message);
      return;
    }

    if (tab === "signup") {
      if (passwordValidationMessage) {
        setShowPasswordValidation(true);
        window.requestAnimationFrame(() => passwordInputRef.current?.focus());
        return;
      }
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,47}$/.test(username.trim())) {
        const message = t("auth.toast.usernameInvalid");
        setFormError(message);
        toast.error(message);
        return;
      }
      try {
        setIsSubmitting(true);
        setFormError(null);
        await checkSignUpAvailability({ username, email });
        if (isPodium) await submitSignup();
        else moveToStep("roles");
      } catch (error) {
        if (isExistingAccountSignUpError(error)) {
          setHasExistingAccountWarning(true);
          setFormError(t("auth.existing.description"));
        } else {
          const message = formatAuthError(error, "sign_up", t);
          setFormError(message);
        }
      } finally {
        setIsSubmitting(false);
      }
    } else {
      try {
        setIsSubmitting(true);
        setFormError(null);
        const account = await signIn({ identifier: loginIdentifier, password });
        toast.success(t("auth.toast.signedIn"));
        navigate(resolvePostAuthRoute(account));
      } catch (error) {
        const message = formatAuthError(error, "sign_in", t);
        setFormError(message);
        toast.error(message);
        window.requestAnimationFrame(() => loginIdentifierInputRef.current?.focus());
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  async function submitSignup() {
    if (isPodium) return;
    const passwordValidationMessage = validatePasswordStrength(password);
    if (passwordValidationMessage) {
      setShowPasswordValidation(true);
      setStep("credentials");
      return;
    }
    try {
      setIsSubmitting(true);
      setFormError(null);
      const [firstName = "", ...restName] = fullName.trim().split(/\s+/);
      const result = await signUp({
        username,
        email,
        password,
        displayName: fullName.trim(),
        firstName,
        lastName: restName.join(" "),
        roles: isPodium ? ["sponsor"] : rolesForAccountType(signupAccountType),
        nextPath: isPodium ? resolvePostAuthRoute(null) : nextPath ?? (signupAccountType !== "organizer"
          ? "/athlete/account?view=edit#athlete-race-history"
          : null),
      });
      if (result.needsEmailVerification) {
        setVerificationEmail(result.email ?? email.trim());
        setPendingSignUp(result.pendingSignUp);
        setPassword("");
        setStep("verify");
        toast.success(t("auth.toast.verifyEmail"));
        return;
      }
      toast.success(t("auth.toast.created"));
      navigate(isPodium ? resolvePostAuthRoute(result.account) : nextPath ?? (signupAccountType !== "organizer"
        ? "/athlete/account?view=edit#athlete-race-history"
        : getDefaultRoute(result.account)));
    } catch (error) {
      if (isExistingAccountSignUpError(error)) {
        setHasExistingAccountWarning(true);
        setStep("credentials");
        toast.warning(t("auth.existing.description"));
      } else {
        const message = formatAuthError(error, "sign_up", t);
        setFormError(message);
        toast.error(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleResendVerification = async () => {
    try {
      setFormError(null);
      await resendVerificationEmail(verificationEmail);
      toast.success(t("auth.verify.resent"));
    } catch (error) {
      const message = formatAuthError(error, "send_email", t);
      setFormError(message);
      toast.error(message);
    }
  };

  const handleChangeVerificationEmail = async () => {
    if (!pendingSignUp) {
      setUsername("");
      setEmail("");
      setStep("credentials");
      return;
    }
    try {
      await cancelPendingSignUp(pendingSignUp);
      setPendingSignUp(null);
      setVerificationEmail("");
      setEmail("");
      setFormError(null);
      setStep("credentials");
      setTab("signup");
    } catch (error) {
      const message = locale === "en" && error instanceof Error
        ? error.message
        : t("auth.verify.cancelError");
      setFormError(message);
      toast.error(message);
    }
  };

  return (
    <main className={`flex min-h-screen min-w-0 overflow-x-hidden ${isPodium ? podiumAccess.page : ""}`}>
      {isPodium ? <PodiumHeader/> : null}
      {/* Left — hero image (hidden on mobile) */}
      <aside aria-label={heroTitle} className={`relative hidden overflow-hidden lg:flex lg:w-1/2 ${isPodium ? podiumAccess.hero : ""}`}>
        <img
          src={heroImg}
          alt={t("auth.hero.imageAlt")}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[hsl(25,15%,8%,0.85)] via-[hsl(25,15%,8%,0.6)] to-[hsl(25,15%,8%,0.3)]" />
        <div className="absolute inset-0 grain-overlay opacity-20" />
        <div className="relative z-10 flex flex-col justify-between p-12">
          <Link to={isPodium ? "/rewards" : "/"} className="flex items-center gap-2" aria-label={isPodium ? "RacesOn Podium" : undefined} translate="no">
            <BrandWordmark className="h-9" eager />
            {isPodium ? <span className="text-xl font-semibold text-white">Podium</span> : null}
          </Link>
          <div className="max-w-md">
            <p className="font-display text-4xl font-extrabold text-white leading-tight">
              {heroTitle}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-white/76">
              {t(isPodium ? "podium.auth.heroDescription" : "auth.hero.description")}
            </p>
          </div>
        </div>
      </aside>

      {/* Right — auth form */}
      <div className={`auth-surface relative flex min-w-0 flex-1 flex-col ${isPodium ? podiumAccess.surface : ""}`}>
        <ThemeToggle className="absolute right-6 top-6 z-10 hidden bg-raised/80 lg:flex" />
        {/* Mobile header */}
        <header className="flex items-center justify-between p-4 lg:hidden">
          <Link to={isPodium ? "/rewards" : "/"} className="flex items-center gap-2" aria-label={isPodium ? "RacesOn Podium" : undefined} translate="no">
            <BrandWordmark onLight className="h-7" eager />
            {isPodium ? <span className="text-lg font-semibold">Podium</span> : null}
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle className="h-11 w-11" />
            <Link
              to="/"
              className="flex min-h-11 items-center gap-1 px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="h-3 w-3" /> {t("common.home")}
            </Link>
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center px-4 py-8">
          <div
            className={`w-full ${
              step === "credentials" || step === "verify"
                ? "max-w-md"
                : step === "roles"
                  ? "max-w-4xl"
                  : "max-w-xl"
            }`}
          >
            <AnimatePresence mode="wait">
              {step === "verify" ? (
                <motion.div
                  key="verify"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.3 }}
                >
                  {formError ? (
                    <div role="alert" className="mb-5 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                      {formError}
                    </div>
                  ) : null}
                  <EmailVerificationPending
                    email={verificationEmail}
                    localTestInbox={localPodium}
                    onResend={handleResendVerification}
                    onChangeEmail={handleChangeVerificationEmail}
                    onSignIn={() => {
                      setLoginIdentifier(verificationEmail);
                      selectTab("login");
                    }}
                  />
                </motion.div>
              ) : step === "credentials" ? (
                <motion.div
                  key="credentials"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* Tab toggle */}
                  <div className="mb-8">
                    {tab === "signup" ? (
                      <div id="auth-step-account" className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-primary-readable">
                        {t(isPodium ? "podium.auth.sponsorAccount" : "auth.step.account")}
                      </div>
                    ) : null}
                    <h1
                      ref={(element) => {
                        credentialsHeadingRef.current = element;
                        if (element && stepFocusIntentRef.current === "credentials") {
                          stepFocusIntentRef.current = null;
                          element.focus();
                        }
                      }}
                      tabIndex={-1}
                      aria-describedby={tab === "signup" ? "auth-step-account" : undefined}
                      className="font-display text-2xl font-extrabold focus:outline-none"
                    >
                      {tab === "login" ? t("auth.login.title") : t(isPodium ? "podium.auth.createSponsor" : "auth.signup.title")}
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {tab === "login"
                        ? t(isPodium ? "podium.auth.loginDescription" : "auth.login.description")
                        : t(isPodium ? "podium.auth.signupDescription" : "auth.signup.description")}
                    </p>
                  </div>

                  <div className="mb-6 flex rounded-xl bg-secondary p-1" role="tablist" aria-label={t("auth.entryOptions")}>
                    {(["login", "signup"] as AuthTab[]).map((tabValue) => (
                      <button
                        key={tabValue}
                        type="button"
                        role="tab"
                        disabled={isPodium && tabValue === "signup"}
                        aria-describedby={isPodium && tabValue === "signup" ? "podium-demo-account-notice" : undefined}
                        aria-selected={tab === tabValue}
                        tabIndex={tab === tabValue ? 0 : -1}
                        ref={(element) => { tabRefs.current[tabValue] = element; }}
                        onClick={() => selectTab(tabValue)}
                        onKeyDown={(event) => {
                          const tabs: AuthTab[] = isPodium ? ["login"] : ["login", "signup"];
                          const currentIndex = tabs.indexOf(tabValue);
                          let nextIndex: number | null = null;
                          if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
                          if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                          if (event.key === "Home") nextIndex = 0;
                          if (event.key === "End") nextIndex = tabs.length - 1;
                          if (nextIndex === null) return;
                          event.preventDefault();
                          selectTab(tabs[nextIndex], true);
                        }}
                        className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
                          tab === tabValue
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tabValue === "login" ? t("auth.signInAction") : <>{signupLabel}{isPodium ? <span className="mt-1 block text-xs">{t("podium.auth.unavailableInDemo")}</span> : null}</>}
                      </button>
                    ))}
                  </div>

                  {isPodium ? <p id="podium-demo-account-notice" className="mb-5 rounded-xl border border-border bg-secondary/50 px-4 py-3 text-sm leading-relaxed">
                    {t("podium.auth.demoAccountsOnly")}
                    {tab === "signup" ? <> <button type="button" className="font-semibold text-primary-readable underline underline-offset-2" onClick={() => selectTab("login", true)}>{t("auth.signInAction")}</button></> : null}
                  </p> : null}

                  {/* Form */}
                  <form onSubmit={handleCredentialsSubmit}>
                    <fieldset disabled={isPodium && tab === "signup"} aria-describedby={isPodium && tab === "signup" ? "podium-demo-account-notice" : undefined} className="space-y-4">
                    {tab === "signup" && hasExistingAccountWarning ? (
                      <ExistingAccountSignUpWarning
                        canResetPassword={Boolean(email.trim())}
                        onSignIn={showLoginForExistingAccount}
                      />
                    ) : null}
                    {formError && !hasExistingAccountWarning ? (
                      <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                        {formError}
                      </div>
                    ) : null}
                    {tab === "signup" && (
                      <div className="relative">
                        <label htmlFor="auth-full-name" className="sr-only">{t("auth.fullName")}</label>
                        <User className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                        <input
                          id="auth-full-name"
                          className={inputClasses}
                          placeholder={t("auth.fullName")}
                          value={fullName}
                          onChange={(event) => {
                            setFullName(event.target.value);
                            setFormError(null);
                          }}
                          autoComplete="name"
                          required
                        />
                      </div>
                    )}
                    {tab === "signup" ? (
                      <>
                        <div className="relative">
                          <label htmlFor="auth-signup-username" className="sr-only">{t("auth.username")}</label>
                          <UserRound className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                          <input
                            id="auth-signup-username"
                            className={inputClasses}
                            placeholder={t("auth.username")}
                            value={username}
                            onChange={(event) => {
                              setUsername(event.target.value);
                              setHasExistingAccountWarning(false);
                              setFormError(null);
                            }}
                            autoComplete="username"
                            autoCapitalize="none"
                            autoCorrect="off"
                            pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,47}"
                            title={t("auth.usernameHint")}
                            required
                          />
                        </div>
                        <div>
                          <div className="relative">
                            <label htmlFor="auth-signup-email" className="sr-only">{t(isPodium ? "podium.auth.email" : "auth.emailOptional")}</label>
                            <Mail className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                            <input
                              id="auth-signup-email"
                              type="email"
                              className={inputClasses}
                              placeholder={t(isPodium ? "podium.auth.email" : "auth.emailOptional")}
                              required={isPodium}
                              value={email}
                              onChange={(event) => {
                                setEmail(event.target.value);
                                setHasExistingAccountWarning(false);
                                setFormError(null);
                              }}
                              autoComplete="email"
                              autoCapitalize="none"
                              autoCorrect="off"
                            />
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {t(localPodium ? "podium.auth.localEmailHint" : isPodium ? "podium.auth.emailHint" : "auth.emailHint")}
                          </p>
                        </div>
                      </>
                    ) : (
                      <div className="relative">
                        <label htmlFor="auth-login-identifier" className="sr-only">{t("auth.loginIdentifier")}</label>
                        <UserRound className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                        <input
                          id="auth-login-identifier"
                          ref={loginIdentifierInputRef}
                          className={inputClasses}
                          placeholder={t("auth.loginIdentifier")}
                          value={loginIdentifier}
                          onChange={(event) => {
                            setLoginIdentifier(event.target.value);
                            setFormError(null);
                          }}
                          autoComplete="username"
                          autoCapitalize="none"
                          autoCorrect="off"
                          required
                        />
                      </div>
                    )}
                    <div className="relative">
                      <label htmlFor="auth-password" className="sr-only">{t("auth.password")}</label>
                      <Lock className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                      <input
                        id="auth-password"
                        ref={passwordInputRef}
                        type={showPassword ? "text" : "password"}
                        className={inputClasses}
                        placeholder={t("auth.password")}
                        value={password}
                        onChange={(event) => {
                          setPassword(event.target.value);
                          setFormError(null);
                          if (showPasswordValidation) {
                            setShowPasswordValidation(true);
                          }
                        }}
                        onBlur={() => setShowPasswordValidation(true)}
                        required
                        aria-describedby={tab === "signup" ? "auth-password-guidance" : undefined}
                        aria-invalid={hasPasswordValidationError ? "true" : undefined}
                        autoComplete={tab === "login" ? "current-password" : "new-password"}
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-3.5 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {tab === "signup" && (
                      <p
                        id="auth-password-guidance"
                        role={hasPasswordValidationError ? "alert" : undefined}
                        className={`text-xs ${
                          hasPasswordValidationError
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {showPasswordValidation && localizedPasswordValidationMessage
                          ? localizedPasswordValidationMessage
                          : t("auth.passwordHint", { count: MIN_PASSWORD_LENGTH })}
                      </p>
                    )}

                    {tab === "login" && (
                      <div className="flex justify-end text-xs">
                        <Link
                          to="/auth/reset"
                          className="text-primary-readable hover:underline underline-offset-2 font-medium"
                        >
                          {t("auth.forgotPassword")}
                        </Link>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting || (isPodium && tab === "signup")}
                      aria-busy={isSubmitting}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-warm transition-all hover:shadow-glow hover:scale-[1.01] active:scale-[0.99]"
                    >
                      {isSubmitting ? t("auth.working") : tab === "login" ? t("auth.signInAction") : (isPodium ? signupLabel : t("auth.continue"))}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                    </fieldset>
                  </form>

                  <p className="mt-6 text-center text-xs text-muted-foreground">
                    {tab === "login" ? (
                      <>
                        {t(isPodium ? "podium.auth.newSponsor" : "auth.noAccount")}{" "}
                        <button
                          disabled={isPodium}
                          aria-describedby={isPodium ? "podium-demo-account-notice" : undefined}
                          onClick={() => selectTab("signup")}
                          className="text-primary-readable font-semibold hover:underline underline-offset-2"
                        >
                          {signupLabel}
                        </button>
                      </>
                    ) : (
                      <>
                        {t("auth.hasAccount")}{" "}
                        <button
                          onClick={() => selectTab("login")}
                          className="text-primary-readable font-semibold hover:underline underline-offset-2"
                        >
                          {t("auth.signInAction")}
                        </button>
                      </>
                    )}
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.3 }}
              >
                  {formError ? (
                    <div role="alert" className="mb-5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                      {formError}
                    </div>
                  ) : null}
                  {step === "roles" && (
                    <>
                      <button
                        onClick={() => moveToStep("credentials")}
                        className="-ml-3 mb-3 flex min-h-11 items-center gap-1 px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ChevronLeft className="h-3 w-3" /> {t("common.back")}
                      </button>

                      <div id="auth-step-access" className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-primary-readable">
                        {t("auth.step.access")}
                      </div>
                      <h1
                        ref={(element) => {
                          rolesHeadingRef.current = element;
                          if (element && stepFocusIntentRef.current === "roles") {
                            stepFocusIntentRef.current = null;
                            element.focus();
                          }
                        }}
                        tabIndex={-1}
                        aria-describedby="auth-step-access"
                        className="mb-2 font-display text-2xl font-extrabold focus:outline-none"
                      >
                        {t("auth.accountType.title")}
                      </h1>
                      <p className="mb-6 text-sm text-muted-foreground">
                        {t("auth.accountType.description")}
                      </p>

                      <div className="grid gap-3">
                        {([
                          {
                            value: "athlete" as const,
                            title: t("auth.accountType.athlete"),
                            icon: Trophy,
                            points: [
                              t("auth.accountType.athletePoint1"),
                              t("auth.accountType.athletePoint2"),
                            ],
                          },
                          {
                            value: "athlete-organizer" as const,
                            title: t("auth.accountType.athleteOrganizer"),
                            icon: Users,
                            points: [
                              t("auth.accountType.bothPoint1"),
                              t("auth.accountType.bothPoint2"),
                            ],
                          },
                          {
                            value: "organizer" as const,
                            title: t("auth.accountType.organizer"),
                            icon: Timer,
                            points: [
                              t("auth.accountType.organizerPoint1"),
                              t("auth.accountType.organizerPoint2"),
                            ],
                          },
                        ] satisfies Array<{
                          value: SignupAccountType;
                          title: string;
                          icon: typeof Trophy;
                          points: string[];
                        }>).map((option) => {
                          const selected = signupAccountType === option.value;
                          const Icon = option.icon;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => setSignupAccountType(option.value)}
                              className={`relative w-full overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200 ${
                                selected
                                  ? "border-primary bg-primary/[0.04] shadow-md"
                                  : "border-border bg-card shadow-soft hover:border-primary/30 hover:shadow-md"
                              }`}
                            >
                              <div
                                className={`absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full border transition-all ${
                                  selected
                                    ? "border-primary bg-primary text-primary-foreground shadow-warm"
                                    : "border-border bg-background"
                                }`}
                                aria-hidden="true"
                              >
                                {selected ? <CheckCircle className="h-4 w-4" /> : null}
                              </div>
                              <div className="flex items-start gap-4 pr-8">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/10 bg-primary/10">
                                  <Icon className="h-5 w-5 text-primary-readable" />
                                </div>
                                <div>
                                  <h3 className="font-display text-base font-bold">{option.title}</h3>
                                  <ul className="mt-3 grid list-disc gap-2 pl-4 text-sm leading-relaxed text-muted-foreground sm:grid-cols-2 sm:gap-x-5">
                                    {option.points.map((point) => <li key={point}>{point}</li>)}
                                  </ul>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {signupAccountType === "organizer" ? (
                        <div className="mt-5 rounded-xl border border-primary/20 bg-primary/[0.045] px-4 py-3 text-sm leading-6 text-muted-foreground">
                          {t("auth.accountType.organizerHint")}
                        </div>
                      ) : (
                        <p className="mt-5 text-sm leading-6 text-muted-foreground">{t("auth.historyAfterSignup")}</p>
                      )}

                      <button
                        onClick={() => void submitSignup()}
                        disabled={isSubmitting}
                        className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-warm transition-all hover:scale-[1.01] hover:shadow-glow active:scale-[0.99] disabled:opacity-60"
                      >
                        {isSubmitting
                          ? t("auth.creating")
                          : signupAccountType === "organizer"
                            ? t("auth.createOrganizer")
                            : t("auth.createAccount")}
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </main>
  );
}
