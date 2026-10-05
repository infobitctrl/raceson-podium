"use client";

import { Globe2, LogOut, Moon, Search, Settings2, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { AppLocale } from "@/shared/i18n/locales";
import { useRouteLocaleChange } from "@/shared/i18n/useRouteLocaleChange";

type DesktopUtilityMenuProps = {
  inverted?: boolean;
  onSignOut?: () => void | Promise<void>;
  searchPath?: string;
};

export function DesktopUtilityMenu({
  inverted = false,
  onSignOut,
  searchPath = "/events",
}: DesktopUtilityMenuProps) {
  const { locale, t } = useI18n();
  const setRouteLocale = useRouteLocaleChange();
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const nextTheme = dark ? "light" : "dark";

  function changeLocale(nextLocale: string) {
    if (nextLocale === "hr" || nextLocale === "en") {
      setRouteLocale(nextLocale satisfies AppLocale);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("common.settings")}
          title={t("common.settings")}
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[5px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            inverted
              ? "border-white/[0.18] bg-black/15 text-white/[0.78] hover:border-accent hover:text-accent"
              : "border-border bg-card text-muted-foreground hover:border-primary/35 hover:text-foreground",
          )}
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-60 rounded-xl p-1.5 shadow-xl">
        <DropdownMenuItem asChild className="min-h-10 cursor-pointer gap-3 rounded-lg px-3">
          <Link to={searchPath} aria-label={locale === "hr" ? "Pretraži RacesOn" : "Search RacesOn"}>
            <Search className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>{t("common.search")}</span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2 px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t("common.language")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={changeLocale}>
          <DropdownMenuRadioItem value="hr" className="min-h-9 cursor-pointer rounded-lg">
            {t("common.croatian")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en" className="min-h-9 cursor-pointer rounded-lg">
            {t("common.english")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {t("common.appearance")}
        </DropdownMenuLabel>
        <DropdownMenuItem
          className="min-h-10 cursor-pointer gap-3 rounded-lg px-3"
          onSelect={() => setTheme(nextTheme)}
        >
          {dark ? (
            <Sun className="h-4 w-4 text-primary" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4 text-primary" aria-hidden="true" />
          )}
          <span>{dark ? t("theme.switchLight") : t("theme.switchDark")}</span>
        </DropdownMenuItem>

        {onSignOut ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="min-h-10 cursor-pointer gap-3 rounded-lg px-3 text-destructive focus:text-destructive"
              onSelect={() => void onSignOut()}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>{t("common.signOut")}</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
