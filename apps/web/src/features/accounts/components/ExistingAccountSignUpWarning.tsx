import { AlertTriangle, KeyRound, LogIn } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "@/shared/i18n/I18nContext";

type ExistingAccountSignUpWarningProps = {
  canResetPassword: boolean;
  onSignIn: () => void;
};

export function ExistingAccountSignUpWarning({
  canResetPassword,
  onSignIn,
}: ExistingAccountSignUpWarningProps) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-4 text-sm text-foreground"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t("auth.existing.title")}</p>
          <p className="mt-1 leading-6 text-muted-foreground">
            {t("auth.existing.description")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-90"
            >
              <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
              {t("auth.signInAction")}
            </button>
            {canResetPassword ? (
              <Link
                to="/auth/reset"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-primary/40"
              >
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                {t("auth.existing.reset")}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
