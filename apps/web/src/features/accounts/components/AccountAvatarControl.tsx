import { useRef } from "react";
import { Upload, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { initialsForName } from "@/lib/account-presentation";
import { useI18n } from "@/shared/i18n/I18nContext";

export function AccountAvatarControl({
  avatarUrl,
  displayName,
  isUploading,
  disabled = false,
  inputTestId,
  onFileSelected,
  onRemove,
}: {
  avatarUrl?: string | null;
  displayName: string;
  isUploading: boolean;
  disabled?: boolean;
  inputTestId?: string;
  onFileSelected: (file: File | null) => void | Promise<void>;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <div className="relative mx-auto w-fit">
        <Avatar className="h-20 w-20 ring-2 ring-card shadow-soft">
          {avatarUrl ? (
            <AvatarImage src={avatarUrl} alt={`${displayName} profile picture`} className="object-cover" />
          ) : null}
          <AvatarFallback className="bg-primary/10 font-display text-xl font-bold text-primary">
            {initialsForName(displayName)}
          </AvatarFallback>
        </Avatar>
        {avatarUrl ? (
          <button
            type="button"
            aria-label={t("account.avatar.remove")}
            title={t("account.avatar.remove")}
            onClick={onRemove}
            className="absolute -right-2 -top-2 flex h-11 w-11 items-center justify-center rounded-full border-2 border-card bg-foreground text-background shadow-soft transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        data-testid={inputTestId}
        onChange={(event) => {
          void onFileSelected(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 min-h-11 w-full"
        disabled={isUploading || disabled}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className={`h-4 w-4 ${isUploading ? "animate-pulse" : ""}`} />
        {t(isUploading ? "account.avatar.uploading" : "account.avatar.upload")}
      </Button>
    </>
  );
}
