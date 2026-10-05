import { useEffect, useState, type FormEvent } from "react";
import { Mail, Pencil, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AccountEmailControlProps = {
  currentEmail: string | null;
  pendingEmail?: string | null;
  emailVerified: boolean;
  canChange: boolean;
  confirmationPath: string;
  controlId: string;
  onChangeEmail: (email: string, confirmationPath: string) => Promise<string>;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AccountEmailControl({
  currentEmail,
  pendingEmail,
  emailVerified,
  canChange,
  confirmationPath,
  controlId,
  onChangeEmail,
}: AccountEmailControlProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [nextEmail, setNextEmail] = useState("");
  const [requestedEmail, setRequestedEmail] = useState<string | null>(pendingEmail ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalizedCurrentEmail = currentEmail?.trim().toLowerCase() ?? "";
  const normalizedNextEmail = nextEmail.trim().toLowerCase();
  const displayedPendingEmail = pendingEmail?.trim().toLowerCase() || requestedEmail;
  const nextEmailIsValid = EMAIL_PATTERN.test(normalizedNextEmail);
  const nextEmailIsDifferent = Boolean(normalizedNextEmail)
    && normalizedNextEmail !== normalizedCurrentEmail
    && normalizedNextEmail !== displayedPendingEmail;

  useEffect(() => {
    setRequestedEmail(pendingEmail?.trim().toLowerCase() ?? null);
  }, [pendingEmail]);

  useEffect(() => {
    if (requestedEmail && normalizedCurrentEmail === requestedEmail) {
      setRequestedEmail(null);
    }
  }, [normalizedCurrentEmail, requestedEmail]);

  function cancelEditing() {
    setNextEmail("");
    setIsEditing(false);
  }

  async function submitEmailChange(event: FormEvent) {
    event.preventDefault();
    if (!canChange || !nextEmailIsValid || !nextEmailIsDifferent) return;

    try {
      setIsSubmitting(true);
      const requested = await onChangeEmail(normalizedNextEmail, confirmationPath);
      setRequestedEmail(requested);
      setNextEmail("");
      setIsEditing(false);
      toast.success(
        normalizedCurrentEmail
          ? `Confirmation sent to ${requested}. Your current email stays active until the change is confirmed.`
          : `Confirmation sent to ${requested}. Keep signing in with your username until the address is confirmed.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to change the email address.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="h-full rounded-xl border border-border/70 bg-background/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Mail className="h-4 w-4 text-primary" />
            Email address
          </div>
          <div className="mt-2 break-all text-sm font-medium text-foreground">
            {currentEmail ?? "No email connected"}
          </div>
        </div>
        <Badge variant={emailVerified ? "default" : "secondary"}>
          {emailVerified ? "Verified" : currentEmail ? "Pending" : "Not connected"}
        </Badge>
      </div>

      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {currentEmail
          ? "Used for sign-in, verification, and account recovery."
          : "No recovery email is connected to this account."}
      </p>

      {displayedPendingEmail ? (
        <div className="mt-3 rounded-lg border border-primary/20 bg-primary/[0.045] p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Confirmation required
          </div>
          <p className="mt-1 break-all text-xs leading-5 text-muted-foreground">
            {normalizedCurrentEmail
              ? `Confirm ${displayedPendingEmail} to make it your new account email. Until then, ${currentEmail} remains active.`
              : `Confirm ${displayedPendingEmail} to add it as your sign-in and recovery email. Until then, keep signing in with your username.`}
          </p>
        </div>
      ) : null}

      {canChange ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => setIsEditing((current) => !current)}
        >
          <Pencil className="h-3.5 w-3.5" />
          {displayedPendingEmail
            ? "Change pending email"
            : normalizedCurrentEmail
              ? "Change email"
              : "Add recovery email"}
        </Button>
      ) : (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          A password sign-in method is required to add or change an email address.
        </p>
      )}

      {isEditing && canChange ? (
        <form className="mt-3 space-y-3 border-t border-border/70 pt-3" onSubmit={submitEmailChange}>
          <div className="space-y-1.5">
            <Label htmlFor={controlId} className="text-xs">New email address</Label>
            <Input
              id={controlId}
              type="email"
              value={nextEmail}
              onChange={(event) => setNextEmail(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="email"
              aria-invalid={Boolean(nextEmail) && (!nextEmailIsValid || !nextEmailIsDifferent)}
              required
            />
            <p className="text-[11px] leading-4 text-muted-foreground">
              {normalizedCurrentEmail
                ? "We will send a confirmation link to the new address. Your current address stays active until confirmation finishes."
                : "We will send a confirmation link to this address. It becomes available for sign-in and recovery only after you confirm it."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting || !nextEmailIsValid || !nextEmailIsDifferent}
            >
              {isSubmitting ? "Sending..." : "Send confirmation"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isSubmitting}
              onClick={cancelEditing}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
