import { useState } from "react";
import { Flag, Footprints, Layers3, Save } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  useAuth,
  type AccountTypeSelection,
} from "@/lib/auth";
import { cn } from "@/lib/utils";
import { accountTypeSelectionForAccount } from "@/features/accounts/model/accountType";
import { MobileDetailDisclosure } from "@/shared/mobile/MobileDetailDisclosure";

type AccountTypeOption = {
  value: AccountTypeSelection;
  title: string;
  description: string;
  icon: typeof Footprints;
};

const accountTypeOptions: AccountTypeOption[] = [
  {
    value: "athlete",
    title: "Athlete",
    description: "Race registration, results, rankings, clubs, and athlete history.",
    icon: Footprints,
  },
  {
    value: "athlete-organizer",
    title: "Athlete + Organizer",
    description: "Use both athlete and organizer workspaces with one sign-in.",
    icon: Layers3,
  },
  {
    value: "organizer",
    title: "Organizer only",
    description: "Manage organizations and races without the athlete workspace.",
    icon: Flag,
  },
];

export function AccountTypeControl() {
  const location = useLocation();
  const navigate = useNavigate();
  const { account, updateAccountType } = useAuth();
  const savedAccountType = accountTypeSelectionForAccount(account);
  const [pendingSelection, setPendingSelection] = useState<AccountTypeSelection | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const selection = pendingSelection ?? savedAccountType;
  const selectedOption = accountTypeOptions.find((option) => option.value === selection) ?? accountTypeOptions[0];

  if (!account || account.accountType === "temporary" || account.testingRole) return null;

  const athleteWillBeHidden = selection === "organizer";
  const organizerWillBeHidden =
    selection === "athlete"
    && ((account.organizations?.length ?? 0) > 0 || account.organizerSetupEnabled);

  async function saveAccountType() {
    try {
      setIsSaving(true);
      const updatedAccount = await updateAccountType(selection);
      setPendingSelection(null);
      toast.success("Account type updated.");

      if (selection === "organizer" && location.pathname.startsWith("/athlete")) {
        navigate(updatedAccount.hasOrganizerAccess ? "/organizer/account" : "/organizer/team");
      } else if (selection === "athlete" && location.pathname.startsWith("/organizer")) {
        navigate("/athlete/account");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update the account type.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <MobileDetailDisclosure
      title="Account type"
      summary={`${selectedOption.title}${selection !== savedAccountType ? " · Unsaved" : ""}`}
      icon={selectedOption.icon}
      hideOnDesktop={false}
      className="rounded-[22px] border-border/70 bg-card/95"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-6 text-muted-foreground">
          Choose which private workspaces are available to this account.
        </p>

        <div role="radiogroup" aria-label="Account type" className="grid gap-2.5 md:grid-cols-3">
          {accountTypeOptions.map((option) => {
            const selected = selection === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPendingSelection(option.value)}
                disabled={isSaving}
                className={cn(
                  "rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  selected
                    ? "border-primary bg-primary/[0.06] shadow-warm"
                    : "border-border/70 bg-background/70 hover:border-primary/35 hover:bg-primary/[0.025]",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <span className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="font-display text-sm font-bold text-foreground">{option.title}</span>
                </span>
                <span className="mt-3 block text-xs leading-5 text-muted-foreground">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted-foreground">
            {athleteWillBeHidden
              ? "Your athlete profile, registrations, and results remain saved. Re-enable Athlete anytime."
              : organizerWillBeHidden
                ? "Your organization memberships remain saved. Re-enable Organizer anytime."
                : "Changing account type never deletes athlete history or organization memberships."}
          </p>
          <Button
            type="button"
            className="shrink-0"
            data-testid="account-type-save"
            disabled={isSaving || selection === savedAccountType}
            onClick={() => void saveAccountType()}
          >
            <Save className="h-4 w-4" />
            {isSaving ? "Saving..." : selection === savedAccountType ? "Saved" : "Save account type"}
          </Button>
        </div>
      </div>
    </MobileDetailDisclosure>
  );
}
