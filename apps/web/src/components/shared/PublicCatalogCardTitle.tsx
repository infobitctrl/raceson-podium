import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export const PUBLIC_CATALOG_CARD_TITLE_CLASS =
  "min-w-0 truncate font-display text-sm font-bold leading-tight text-foreground transition-colors group-hover:text-primary sm:text-base";

export default function PublicCatalogCardTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<"h3">) {
  return <h3 className={cn(PUBLIC_CATALOG_CARD_TITLE_CLASS, className)} {...props} />;
}
