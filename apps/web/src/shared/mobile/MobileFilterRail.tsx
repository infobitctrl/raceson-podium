import type { ComponentPropsWithoutRef } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type MobileFilterSelectOption<TValue extends string = string> = {
  value: TValue;
  label: string;
};

export function MobileFilterSelect<TValue extends string>({
  label,
  value,
  options,
  onChange,
  showLabel = true,
  className,
}: {
  label: string;
  value: TValue;
  options: readonly MobileFilterSelectOption<TValue>[];
  onChange: (value: TValue) => void;
  showLabel?: boolean;
  className?: string;
}) {
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className={cn("block sm:hidden", className)}>
      {showLabel ? (
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!options.length}>
          <button
            type="button"
            aria-label={label}
            data-mobile-filter-select
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background py-2.5 pl-3.5 pr-3 text-left text-sm font-semibold text-foreground shadow-sm outline-none transition hover:border-primary/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="min-w-0 flex-1 truncate">{selectedOption?.label ?? label}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-[80] max-h-[min(60vh,24rem)] w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border-border/80 bg-card p-1.5 shadow-xl"
        >
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(nextValue) => onChange(nextValue as TValue)}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className="min-h-11 cursor-pointer rounded-lg py-2.5 pl-9 pr-3 text-sm font-semibold"
              >
                <span className="min-w-0 whitespace-normal leading-5">{option.label}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function MobileFilterRail({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "hidden min-w-0 gap-2 sm:flex sm:flex-wrap",
        className,
      )}
    />
  );
}

export function MobileFilterButton({ className, type = "button", ...props }: ComponentPropsWithoutRef<"button">) {
  return (
    <button
      {...props}
      type={type}
      data-mobile-filter
      className={cn(
        "inline-flex min-h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
        className,
      )}
    />
  );
}
