import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AtSign, Eye, EyeOff, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AccountUsernameControlProps = {
  username: string | null;
  changeAvailableAt: string | null;
  canChange: boolean;
  changeDisabledReason?: string;
  onChangeUsername: (username: string, currentPassword: string) => Promise<unknown>;
};

function formatAvailableDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function AccountUsernameControl({
  username,
  changeAvailableAt,
  canChange,
  changeDisabledReason,
  onChangeUsername,
}: AccountUsernameControlProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [nextUsername, setNextUsername] = useState(username ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalizedUsername = nextUsername.trim().toLowerCase();
  const usernameIsValid = /^[a-z0-9][a-z0-9._-]{2,47}$/.test(normalizedUsername);
  const availableTimestamp = changeAvailableAt ? Date.parse(changeAvailableAt) : Number.NaN;
  const cooldownActive = Number.isFinite(availableTimestamp) && availableTimestamp > Date.now();
  const availableDate = useMemo(
    () => changeAvailableAt ? formatAvailableDate(changeAvailableAt) : null,
    [changeAvailableAt],
  );

  useEffect(() => {
    setNextUsername(username ?? "");
  }, [username]);

  async function submitUsernameChange(event: FormEvent) {
    event.preventDefault();
    if (
      !canChange
      || cooldownActive
      || !usernameIsValid
      || !currentPassword
      || normalizedUsername === username
    ) return;

    try {
      setIsSubmitting(true);
      await onChangeUsername(normalizedUsername, currentPassword);
      setCurrentPassword("");
      setIsEditing(false);
      toast.success(username ? "Username changed." : "Username added. You can now use it to sign in.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to change the username.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="h-full rounded-xl border border-border/70 bg-background/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <AtSign className="h-4 w-4 text-primary" />
            Username
          </div>
          <div className="mt-2 font-medium text-foreground">
            {username ? `@${username}` : "Not set"}
          </div>
        </div>
        <Badge variant="outline">Login ID</Badge>
      </div>

      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {username
          ? "Use this username or your account email to sign in."
          : "Choose a username so you can sign in without entering your email."}
      </p>

      {cooldownActive && availableDate ? (
        <p className="mt-2 text-xs font-medium text-muted-foreground">
          You can change it again after {availableDate}.
        </p>
      ) : null}

      {canChange ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={cooldownActive}
          onClick={() => setIsEditing((current) => !current)}
        >
          <Pencil className="h-3.5 w-3.5" />
          {username ? "Change username" : "Choose username"}
        </Button>
      ) : (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {changeDisabledReason ?? "Username changes are unavailable for this account."}
        </p>
      )}

      {isEditing && canChange && !cooldownActive ? (
        <form className="mt-3 space-y-3 border-t border-border/70 pt-3" onSubmit={submitUsernameChange}>
          <div className="space-y-1.5">
            <Label htmlFor="account-login-username" className="text-xs">New username</Label>
            <Input
              id="account-login-username"
              value={nextUsername}
              onChange={(event) => setNextUsername(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,47}"
              aria-invalid={Boolean(nextUsername) && !usernameIsValid}
              required
            />
            <p className="text-[11px] leading-4 text-muted-foreground">
              3–48 letters, numbers, dots, underscores, or hyphens.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="account-username-current-password" className="text-xs">
              Current password
            </Label>
            <div className="relative">
              <Input
                id="account-username-current-password"
                type={showPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                className="pr-11"
                required
              />
              <button
                type="button"
                className="absolute right-3 top-2.5 rounded p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide current password" : "Show current password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <p className="text-[11px] leading-4 text-muted-foreground">
            Usernames can be changed once every 30 days. Your previous username stays reserved for 90 days.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={
                isSubmitting
                || !usernameIsValid
                || !currentPassword
                || normalizedUsername === username
              }
            >
              {isSubmitting ? "Saving..." : "Save username"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isSubmitting}
              onClick={() => {
                setNextUsername(username ?? "");
                setCurrentPassword("");
                setIsEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
