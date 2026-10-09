"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { useI18n } from "@/shared/i18n/I18nContext";
import { readExplicitLocale } from "@/shared/i18n/browser-locale";

function DemoLocale() {
  const { setLocale } = useI18n();
  useEffect(() => {
    const savedLocale = readExplicitLocale();
    setLocale(savedLocale ?? "en", { persist: false, source: savedLocale ? "explicit" : "default" });
  }, [setLocale]);
  return null;
}

function DemoLoading() {
  const { t } = useI18n();
  return <p role="status" className="p-6 text-center text-sm text-muted-foreground">{t("rewards.loading")}</p>;
}
const DemoApp = dynamic(() => import("./RewardsDemoApp"), { ssr: false, loading: DemoLoading });

export default function RewardsDemoEntry() {
  // The server and first browser render agree; a saved locale follows
  // hydration, then the existing account synchronizer owns a signed-in choice.
  return <I18nProvider initialLocale="en"><DemoLocale /><DemoApp /></I18nProvider>;
}
