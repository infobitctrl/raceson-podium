"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/shared/i18n/I18nContext";
import { normalizeAppLocale } from "@/shared/i18n/locales";

export function AccountLocaleSynchronizer() {
  const { account } = useAuth();
  const { setLocale, source } = useI18n();
  const synchronizedAccountLocale = useRef<string | null>(null);

  useEffect(() => {
    if (source === "explicit") return;

    const accountLocale = normalizeAppLocale(account?.locale);
    if (!accountLocale) return;

    const synchronizationKey = `${account?.userId ?? "anonymous"}:${accountLocale}`;
    if (synchronizedAccountLocale.current === synchronizationKey) return;

    synchronizedAccountLocale.current = synchronizationKey;
    setLocale(accountLocale, { source: "profile" });
  }, [account?.locale, account?.userId, setLocale, source]);

  return null;
}
