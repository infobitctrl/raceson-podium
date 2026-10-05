import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function LocaleStablePillLabel({
  children,
  className,
  referenceLabel,
}: {
  children: ReactNode;
  className?: string;
  referenceLabel: string;
}) {
  return (
    <span
      className={cn("relative inline-block align-middle", className)}
      data-i18n-skip
      data-locale-pill-reference={referenceLabel}
    >
      <span aria-hidden="true" className="invisible whitespace-nowrap">
        {referenceLabel}
      </span>
      <span
        data-locale-fit="stable-pill"
        className="absolute inset-0 flex items-center justify-center whitespace-nowrap"
      >
        {children}
      </span>
    </span>
  );
}
