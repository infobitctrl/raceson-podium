import { Languages, LogOut, Palette } from "lucide-react";
import ThemeToggle from "@/components/shared/ThemeToggle";
import { LanguageSwitcher } from "@/shared/i18n/LanguageSwitcher";
import { useI18n } from "@/shared/i18n/I18nContext";
import { useRouteLocaleChange } from "@/shared/i18n/useRouteLocaleChange";

export function MobileMoreUtilities({
  onSignOut,
}: {
  onSignOut?: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const changeLocale = useRouteLocaleChange();

  return (
    <div data-mobile-more-utilities className="space-y-1 py-1">
      <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-3 text-sm font-semibold text-foreground">
          <Languages className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{t("common.language")}</span>
        </div>
        <LanguageSwitcher
          compact
          className="h-auto [&_button]:min-h-11 [&_button]:min-w-11"
          onLocaleChange={changeLocale}
        />
      </div>

      <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-3 text-sm font-semibold text-foreground">
          <Palette className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{t("common.appearance")}</span>
        </div>
        <ThemeToggle className="h-11 w-11 rounded-full shadow-none" />
      </div>

      {onSignOut ? (
        <button
          type="button"
          onClick={() => void onSignOut()}
          className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          <span>{t("common.signOut")}</span>
        </button>
      ) : null}
    </div>
  );
}
