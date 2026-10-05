import { Check } from "lucide-react";
import { DEFAULT_ATHLETE_AVATARS } from "@raceson/domain/athletes";
import { cn } from "@/lib/utils";

export function ProfileAvatarPicker({
  value,
  onChange,
  className,
  compact = false,
}: {
  value: string;
  onChange: (path: string) => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("mt-4 border-t border-border/70 pt-4", className)}>
      <div className="text-xs font-medium text-foreground">Choose a RacesOn avatar</div>
      {!compact ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Pick any trail illustration instead of uploading a photo.
        </p>
      ) : null}
      <div
        role="group"
        aria-label="RacesOn avatar choices"
        className={compact ? "mt-3 flex gap-2 overflow-x-auto pb-2" : "mt-3 grid grid-cols-5 gap-2"}
      >
        {DEFAULT_ATHLETE_AVATARS.map((avatar) => {
          const selected = value === avatar.path;
          return (
            <button
              key={avatar.id}
              type="button"
              aria-label={avatar.label}
              aria-pressed={selected}
              title={avatar.label}
              className={cn(
                "relative aspect-square overflow-hidden rounded-full border-2 bg-muted transition hover:-translate-y-0.5 hover:border-primary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                compact && "h-10 w-10 shrink-0",
                selected ? "border-primary ring-2 ring-primary/20" : "border-border/80",
              )}
              onClick={() => onChange(avatar.path)}
            >
              <img
                src={avatar.path}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
              {selected ? (
                <span className="absolute bottom-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                  <Check className="h-3 w-3" aria-hidden="true" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
