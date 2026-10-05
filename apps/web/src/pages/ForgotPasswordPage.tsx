import PodiumHeader from "@/features/rewards/components/PodiumHeader";
import podiumAccess from "@/features/rewards/components/PodiumAccess.module.css";
import {publicEnv} from "@/lib/public-env";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { UserRound, ArrowRight, ChevronLeft, CheckCircle2, Eye, EyeOff, Lock } from "lucide-react";
import heroImgAsset from "@/assets/hero-biokovo.jpg";
import { toast } from "sonner";
import {
  MIN_PASSWORD_LENGTH,
  clearPasswordRecoveryIntent,
  hasPasswordRecoveryCallbackError,
  hasPasswordRecoveryIntent,
  localAuthInboxUrl,
  rememberPasswordRecoveryIntent,
  validatePasswordStrength,
} from "@/lib/auth-security";
import { useAuth } from "@/lib/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { staticAssetUrl } from "@/lib/static-asset";
import { BrandWordmark } from "@/shared/brand/BrandWordmark";
import ThemeToggle from "@/components/shared/ThemeToggle";
import { useI18n } from "@/shared/i18n/I18nContext";
import { formatAuthError } from "@/features/accounts/model/authErrorMessages";

const heroImg = staticAssetUrl(heroImgAsset);

const inputClasses =
  "min-w-0 w-full rounded-xl border border-input bg-raised/85 px-4 py-3 pl-11 pr-14 text-sm text-foreground shadow-[inset_0_1px_0_hsl(var(--foreground)/0.025)] placeholder:text-muted-foreground transition-[background-color,border-color,box-shadow] hover:border-foreground/25 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25";

export default function ForgotPasswordPage() {
  const { t, locale } = useI18n();
  const isPodium = Boolean(publicEnv.rewardDemo),hr = locale === "hr";
  const location = useLocation();
  const navigate = useNavigate();
  const { requestPasswordReset, updatePassword } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const callbackHasError = hasPasswordRecoveryCallbackError(location.search, location.hash);
  const [recoveryMode, setRecoveryMode] = useState(() =>
    !callbackHasError && hasPasswordRecoveryIntent(
      location.pathname,
      location.search,
      location.hash,
    )
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswordValidation, setShowPasswordValidation] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(() =>
    callbackHasError ? t("auth.error.recoverySessionExpired") : null
  );
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const resendButtonRef = useRef<HTMLButtonElement>(null);
  const focusConfirmationRef = useRef(false);
  const authInboxUrl = localAuthInboxUrl();
  const passwordGuidanceId = "reset-password-guidance";
  const passwordValidationMessage =
    password.length > 0 ? validatePasswordStrength(password) : null;

  useLayoutEffect(() => {
    if (!sent || !focusConfirmationRef.current) return;
    if (!confirmationHeadingRef.current) return;
    focusConfirmationRef.current = false;
    confirmationHeadingRef.current.focus();
  }, [sent]);

  useEffect(() => {
    if (hasPasswordRecoveryCallbackError(location.search, location.hash)) {
      clearPasswordRecoveryIntent();
      setRecoveryMode(false);
      setFormError(t("auth.error.recoverySessionExpired"));
    } else if (
      hasPasswordRecoveryIntent(location.pathname, location.search, location.hash)
    ) {
      setRecoveryMode(true);
    }

    const client = getSupabaseBrowserClient();
    if (!client) return;

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        rememberPasswordRecoveryIntent();
        setRecoveryMode(true);
      }
    });

    return () => subscription.unsubscribe();
  }, [location.hash, location.pathname, location.search, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier) return;

    try {
      setIsSubmitting(true);
      setFormError(null);
      await requestPasswordReset(identifier);
      toast.success(t("auth.reset.requested"));
      focusConfirmationRef.current = true;
      setSent(true);
    } catch (error) {
      const message = formatAuthError(error, "send_email", t);
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    const passwordValidationMessage = validatePasswordStrength(password);
    if (passwordValidationMessage) {
      setShowPasswordValidation(true);
      return;
    }

    if (password !== confirmPassword) {
      const message = t("auth.reset.passwordMismatch");
      setFormError(message);
      toast.error(message);
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError(null);
      await updatePassword(password);
      clearPasswordRecoveryIntent();
      toast.success(t("auth.reset.passwordUpdated"));
      navigate("/auth");
    } catch (error) {
      const message = formatAuthError(error, "update_password", t);
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`min-h-screen min-w-0 w-full flex ${isPodium ? podiumAccess.page : ""}`}>
      {isPodium ? <PodiumHeader/> : null}
      {/* Left hero */}
      <div className={`hidden lg:flex lg:w-1/2 relative overflow-hidden ${isPodium ? podiumAccess.hero : ""}`}>
        <img src={heroImg} alt={t("auth.hero.imageAlt")} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[hsl(25,15%,8%,0.85)] via-[hsl(25,15%,8%,0.6)] to-[hsl(25,15%,8%,0.3)]" />
        <div className="absolute inset-0 grain-overlay opacity-20" />
        <div className="relative z-10 flex flex-col justify-between p-12">
          <Link to={isPodium ? "/rewards" : "/"} className="flex items-center gap-2" aria-label={isPodium ? "RacesOn Podium" : undefined} translate="no">
            <BrandWordmark className="h-9" eager />{isPodium ? <span className="text-2xl italic text-white">Podium</span> : null}
          </Link>
          <div className="max-w-md">
            <h2 className="font-display text-4xl font-extrabold text-white leading-tight">
              {t("auth.reset.heroTitle")}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-white/76">
              {isPodium ? (hr ? "Vrati pristup svom računu za nagrade Podiuma." : "Get back to your Podium rewards account.") : t("auth.reset.heroDescription")}
            </p>
          </div>
        </div>
      </div>

      {/* Right form */}
      <div className={`auth-surface relative min-w-0 flex flex-1 flex-col ${isPodium ? podiumAccess.surface : ""}`}>
        <ThemeToggle className="absolute right-6 top-6 z-10 hidden bg-raised/80 lg:flex" />
        {/* Mobile header */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 lg:hidden">
          <Link to={isPodium ? "/rewards" : "/"} className="flex items-center gap-2" aria-label={isPodium ? "RacesOn Podium" : undefined} translate="no">
            <BrandWordmark onLight className="h-7" eager />{isPodium ? <span className="text-xl italic">Podium</span> : null}
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle className="h-11 w-11" />
            <Link
              to="/auth"
              className="flex min-h-11 items-center gap-1 px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="h-3 w-3" /> {t("auth.reset.backToLogin")}
            </Link>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center px-4 py-8">
          <div className="min-w-0 w-full max-w-md">
            <AnimatePresence mode="wait">
              {recoveryMode ? (
                <motion.div
                  key="recovery"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.3 }}
                >
                  <h1 className="font-display text-2xl font-extrabold">
                    {t("auth.reset.newPasswordTitle")}
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("auth.reset.newPasswordDescription", { count: MIN_PASSWORD_LENGTH })}
                  </p>

                  <form onSubmit={handlePasswordUpdate} className="mt-8 space-y-4">
                    {formError ? (
                      <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                        {formError}
                      </div>
                    ) : null}
                    <div className="relative">
                      <label htmlFor="reset-new-password" className="sr-only">{t("auth.reset.newPassword")}</label>
                      <Lock className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                      <input
                        id="reset-new-password"
                        aria-describedby={passwordGuidanceId}
                        aria-invalid={showPasswordValidation && Boolean(passwordValidationMessage)}
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setFormError(null);
                        }}
                        onBlur={() => setShowPasswordValidation(true)}
                        className={inputClasses}
                        placeholder={t("auth.reset.newPassword")}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                        onClick={() => setShowPassword((value) => !value)}
                        className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 transition-colors"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p
                      id={passwordGuidanceId}
                      className={`text-xs ${
                        showPasswordValidation && passwordValidationMessage
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {showPasswordValidation && passwordValidationMessage
                        ? passwordValidationMessage
                        : t("auth.passwordHint", { count: MIN_PASSWORD_LENGTH })}
                    </p>

                    <div className="relative">
                      <label htmlFor="reset-confirm-password" className="sr-only">{t("auth.reset.confirmPassword")}</label>
                      <Lock className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                      <input
                        id="reset-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          setFormError(null);
                        }}
                        className={inputClasses}
                        placeholder={t("auth.reset.confirmPassword")}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        aria-label={showConfirmPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                        onClick={() => setShowConfirmPassword((value) => !value)}
                        className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 transition-colors"
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-warm transition-all hover:shadow-glow hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
                    >
                      {isSubmitting ? t("auth.reset.updatingPassword") : t("auth.reset.updatePassword")}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </form>
                </motion.div>
              ) : !sent ? (
                <motion.div
                  key="form"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.3 }}
                >
                  <Link
                    to="/auth"
                    className="mb-6 hidden items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground lg:inline-flex"
                  >
                    <ChevronLeft className="h-3 w-3" /> {t("auth.reset.backToLogin")}
                  </Link>

                  <h1 className="font-display text-2xl font-extrabold">
                    {t("auth.reset.title")}
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("auth.reset.description")}
                  </p>

                  <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                    {formError ? (
                      <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                        {formError}
                      </div>
                    ) : null}
                    <div className="relative">
                      <label htmlFor="reset-identifier" className="sr-only">{t("auth.loginIdentifier")}</label>
                      <UserRound className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                      <input
                        id="reset-identifier"
                        type="text"
                        value={identifier}
                        onChange={(e) => {
                          setIdentifier(e.target.value);
                          setFormError(null);
                        }}
                        className={inputClasses}
                        placeholder={t("auth.loginIdentifier")}
                        autoComplete="username"
                        autoCapitalize="none"
                        autoCorrect="off"
                        required
                      />
                    </div>

                    <p className="text-xs leading-5 text-muted-foreground">
                      {isPodium ? (hr ? "Nemaš email za oporavak? Obrati se podršci RacesOn za provjeru vlasništva računa. Nemoj slati lozinku, privatni ključ ni frazu za oporavak novčanika." : "No recovery email? Contact RacesOn support to verify account ownership. Never send your password, private key or wallet recovery phrase.") : t("auth.reset.noEmailHelp")}
                    </p>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-warm transition-all hover:shadow-glow hover:scale-[1.01] active:scale-[0.99]"
                    >
                      {isSubmitting ? t("auth.reset.sending") : t("auth.reset.send")}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </form>
                </motion.div>
              ) : (
                <motion.div
                  key="confirmation"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="text-center"
                >
                  <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-trail-green/10 border border-trail-green/10">
                    <CheckCircle2 className="h-8 w-8 text-trail-green" />
                  </div>

                  <h1
                    ref={(element) => {
                      confirmationHeadingRef.current = element;
                      if (element && focusConfirmationRef.current) {
                        focusConfirmationRef.current = false;
                        element.focus();
                      }
                    }}
                    tabIndex={-1}
                    className="font-display text-2xl font-extrabold focus:outline-none"
                  >
                    {authInboxUrl ? t("auth.reset.localInboxTitle") : t("auth.reset.checkInbox")}
                  </h1>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                    {authInboxUrl ? (
                      t("auth.reset.localInboxDescription", { email: identifier })
                    ) : (
                      <>
                        {t("auth.reset.neutralConfirmation")}
                      </>
                    )}
                  </p>

                  <div className="mt-8 space-y-3">
                    {authInboxUrl ? (
                      <a
                        href={authInboxUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground shadow-warm transition-all hover:scale-[1.01] hover:shadow-glow active:scale-[0.99]"
                      >
                        {t("auth.reset.openLocalInbox")}
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    ) : null}
                    <button
                      ref={resendButtonRef}
                      onClick={async () => {
                        try {
                          setIsSubmitting(true);
                          await requestPasswordReset(identifier);
                          toast.success(t("auth.reset.resent"));
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : t("auth.reset.requestError"));
                        } finally {
                          setIsSubmitting(false);
                          window.requestAnimationFrame(() => resendButtonRef.current?.focus());
                        }
                      }}
                      disabled={isSubmitting}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-semibold transition-all hover:bg-secondary hover:border-primary/20"
                    >
                      {isSubmitting ? t("auth.reset.sending") : t("auth.reset.resend")}
                    </button>

                    <Link
                      to="/auth"
                      className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all active:scale-[0.99] ${
                        authInboxUrl
                          ? "border border-border bg-card hover:border-primary/20 hover:bg-secondary"
                          : "bg-primary text-primary-foreground shadow-warm hover:scale-[1.01] hover:shadow-glow"
                      }`}
                    >
                      {t("auth.reset.backToLogin")}
                    </Link>
                  </div>

                  <p className="mt-6 text-xs text-muted-foreground">
                    {authInboxUrl
                      ? t("auth.reset.localInboxMissing")
                      : isPodium ? (hr ? "Provjeri neželjenu poštu. Ako ne možeš pristupiti emailu za oporavak, obrati se podršci RacesOn za provjeru vlasništva računa." : "Check spam. If you cannot access your recovery email, contact RacesOn support to verify account ownership.") : t("auth.reset.notReceived")}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
