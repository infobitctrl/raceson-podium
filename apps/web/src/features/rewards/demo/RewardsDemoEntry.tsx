"use client";

import dynamic from "next/dynamic";
import { PodiumI18nProvider } from "./PodiumI18nProvider";
import { useI18n } from "@/shared/i18n/I18nContext";

function DemoLoading() {
  const { t } = useI18n();
  return <p role="status" className="p-6 text-center text-sm text-muted-foreground">{t("rewards.loading")}</p>;
}
const DemoApp = dynamic(() => import("./RewardsDemoApp"), { ssr: false, loading: DemoLoading });

export default function RewardsDemoEntry() {
  // The hackathon uses English without changing stored language preferences.
  return <PodiumI18nProvider><DemoApp /></PodiumI18nProvider>;
}
