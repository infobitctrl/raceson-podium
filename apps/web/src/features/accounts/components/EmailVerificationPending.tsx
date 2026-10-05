import { useState } from "react";
import { ArrowLeft, Loader2, MailCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";

type EmailVerificationPendingProps = {
  email: string;
  localTestInbox?: boolean;
  onResend: () => Promise<void>;
  onChangeEmail: () => Promise<void>;
  onSignIn: () => void;
};

export function EmailVerificationPending({
  email,
  localTestInbox = false,
  onResend,
  onChangeEmail,
  onSignIn,
}: EmailVerificationPendingProps) {
  const { t } = useI18n();
  const [isResending, setIsResending] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  async function resend() {
    try {
      setIsResending(true);
      await onResend();
    } finally {
      setIsResending(false);
    }
  }

  async function changeEmail() {
    try {
      setIsCancelling(true);
      await onChangeEmail();
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <section aria-labelledby="email-verification-title" className="rounded-2xl border border-primary/20 bg-card p-6 shadow-soft">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <MailCheck className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 id="email-verification-title" className="mt-5 font-display text-2xl font-extrabold">
        {t("auth.verify.title")}
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {t(localTestInbox ? "podium.auth.localEmailDelivery" : "auth.verify.description", { email })}
      </p>
      <div className="mt-5 rounded-xl border border-border bg-background/70 px-4 py-3 text-sm">
        <span className="font-semibold text-foreground">{email}</span>
      </div>
      {localTestInbox ? <a
        href="http://127.0.0.1:55324"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >{t("podium.auth.openTestInbox")}</a> : null}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {t("auth.verify.keepOpen")}
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Button type="button" onClick={() => void resend()} disabled={isResending || isCancelling}>
          {isResending
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}
          {isResending ? t("auth.verify.resending") : t("auth.verify.resend")}
        </Button>
        <Button type="button" variant="outline" onClick={() => void changeEmail()} disabled={isResending || isCancelling}>
          {isCancelling
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            : <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />}
          {isCancelling ? t("auth.verify.cancelling") : t("auth.verify.changeEmail")}
        </Button>
      </div>
      <button
        type="button"
        onClick={onSignIn}
        className="mt-5 w-full text-center text-sm font-semibold text-primary hover:underline underline-offset-4"
      >
        {t("auth.verify.signIn")}
      </button>
    </section>
  );
}
