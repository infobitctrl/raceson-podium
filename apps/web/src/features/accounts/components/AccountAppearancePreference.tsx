"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useI18n } from "@/shared/i18n/I18nContext";

type AccountAppearancePreferenceProps = {
  id: string;
};

export function AccountAppearancePreference({ id }: AccountAppearancePreferenceProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selectedTheme = mounted && resolvedTheme === "dark" ? "dark" : "light";
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-foreground/80">
        {t("common.appearance")}
      </label>
      <select
        id={id}
        aria-describedby={hintId}
        value={selectedTheme}
        disabled={!mounted}
        onChange={(event) => setTheme(event.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
      >
        <option value="light">{t("theme.switchLight")}</option>
        <option value="dark">{t("theme.switchDark")}</option>
      </select>
      <p id={hintId} className="text-[11px] leading-4 text-muted-foreground">
        {t("profile.appearanceHint")}
      </p>
    </div>
  );
}
