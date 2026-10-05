"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { useI18n } from "@/shared/i18n/I18nContext";
import { LanguageSwitcher } from "@/shared/i18n/LanguageSwitcher";
import { publicEnv } from "@/lib/public-env";
import { readExplicitLocale, resolveBrowserLocale } from "@/shared/i18n/browser-locale";

function DemoLocale() {
  const { setLocale } = useI18n();
  useEffect(() => {
    setLocale(resolveBrowserLocale(), { persist: false, source: readExplicitLocale() ? "explicit" : "device" });
  }, [setLocale]);
  return null;
}

function DemoLoading() {
  const { t } = useI18n();
  return <p role="status" className="p-6 text-center text-sm text-muted-foreground">{t("rewards.loading")}</p>;
}
const DemoApp = dynamic(() => import("./RewardsDemoApp"), { ssr: false, loading: DemoLoading });

function DemoNotice() {
  const { t, locale } = useI18n();
  return <aside aria-label={t("rewards.demo.label")} className="border-b border-border bg-background px-4 py-1">
    <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4">
      <details className="min-w-0 flex-1 text-xs"><summary className="cursor-pointer py-2 text-muted-foreground">{publicEnv.rewardDemo?.chainId === 31337 ? (locale === "hr" ? "Lokalna simulacija · test MON" : "Local simulation · test MON") : "Monad testnet · test MON"}</summary>
        <p className="max-w-2xl pb-3 leading-relaxed">{t(publicEnv.rewardDemo?.chainId === 31337 ? "rewards.demo.localNotice" : "rewards.demo.notice")}</p>
      </details>
      <div className="shrink-0"><LanguageSwitcher compact /></div>
    </div>
  </aside>;
}

export default function RewardsDemoEntry() {
  // The server and first browser render agree; saved/device locale follows
  // hydration, then the existing account synchronizer owns a signed-in choice.
  return <I18nProvider initialLocale="en"><DemoLocale /><DemoNotice /><DemoApp /></I18nProvider>;
}
