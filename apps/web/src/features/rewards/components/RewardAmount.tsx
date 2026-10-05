import { useI18n } from "@/shared/i18n/I18nContext";
import { formatTestMon } from "../model/athleteRewards";
import { productCopy } from "../model/productCopy";

import { roundedRewardAmount } from "../model/rewardDisplayAmount";

export default function RewardAmount({ wei, className }: { wei: string; className?: string }) {
  const { locale, t } = useI18n(), copy = productCopy(locale), amount = roundedRewardAmount(wei, locale);
  return <div className="min-w-0 space-y-1">
    <p className={className}>{amount.approximate && !amount.text.startsWith("<") ? "≈ " : ""}{amount.text} <span className="text-sm font-medium">{t("rewards.testMon")}</span></p>
    {amount.approximate ? <p className="text-xs text-muted-foreground">{copy.rounded}</p> : null}
    <details className="text-xs"><summary className="cursor-pointer">{copy.exact}</summary>
      <p className="mt-2 break-all tabular-nums">{formatTestMon(wei, locale)} {t("rewards.testMon")}</p>
      <p className="break-all font-mono">{copy.wei}: {wei}</p>
    </details>
  </div>;
}
