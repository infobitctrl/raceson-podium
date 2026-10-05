import type { AthleteAwardBreakdownV3 } from "@raceson/domain/rewards/athlete-allocations-v3";
import { useI18n } from "@/shared/i18n/I18nContext";
import { productCopy } from "../model/productCopy";
import { formatTestMon } from "../model/athleteRewards";

/** A recipient-only explanation of saved approval rows, never a new calculator. */
export default function RewardAwardBreakdownV3({ breakdown }: { breakdown: AthleteAwardBreakdownV3 }) {
  const { locale, t } = useI18n(), copy = productCopy(locale);
  const amount = (wei: string) => `${formatTestMon(wei, locale)} ${t("rewards.testMon")}`;
  const metres = (value: string) => new Intl.NumberFormat(locale).format(BigInt(value));
  return <details className="rounded-lg border border-border p-3 text-sm">
    <summary className="cursor-pointer font-medium">{copy.breakdownTitle}</summary>
    <p className="mt-3 text-xs text-muted-foreground">{copy.breakdownHelp}</p>
    <ul className="mt-3 space-y-4">{breakdown.components.map(part => <li key={part.kind === "placing" ? part.categoryId : part.kind} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{part.kind === "placing" ? `${copy.placing} · ${part.rank}` : copy.distanceReward}</span>
        <span className="break-all tabular-nums">{amount(part.amountWei)}</span>
      </div>
      <p className="text-xs">{copy.approvedPool}: {amount(part.poolWei)}</p>
      {part.kind === "participation" ? <p className="text-xs">
        {copy.distanceFormula}: {metres(part.metres)} / {metres(part.totalMetres)} m · {part.finishes} {copy.finishes}.
        {" "}{copy.roundingHelp}
      </p> : <p className="text-xs text-muted-foreground">{copy.placingHelp}</p>}
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{copy.sourceIdentifiers}</summary>
        <dl className="mt-2 space-y-2 break-all font-mono">
          {part.kind === "placing" ? <><div><dt>{copy.categoryIdentifier}</dt><dd>{part.categoryId}</dd></div>
            <div><dt>{copy.source}</dt><dd>{part.sourceRowId}</dd></div></>
            : <div><dt>{copy.contributingResults}</dt>{part.resultIds.map(id => <dd key={id}>{id}</dd>)}</div>}
        </dl>
      </details>
    </li>)}</ul>
  </details>;
}
