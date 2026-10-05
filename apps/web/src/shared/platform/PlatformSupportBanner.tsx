import { ShieldCheck, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function PlatformSupportBanner({
  target,
  description,
  exitTo,
  onExit,
}: {
  target: string;
  description: string;
  exitTo: string;
  onExit?: () => void;
}) {
  return (
    <aside
      aria-label="Platform support mode"
      className="border-b border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-amber-950 dark:text-amber-100"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-bold">{`Support mode · ${target}`}</p>
            <p className="text-xs opacity-80">{description}</p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline" className="h-8 shrink-0 bg-background/80">
          <Link to={exitTo} onClick={onExit}>
            <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Exit support mode
          </Link>
        </Button>
      </div>
    </aside>
  );
}
