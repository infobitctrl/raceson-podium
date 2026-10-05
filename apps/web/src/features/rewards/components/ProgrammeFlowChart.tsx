import { useI18n } from "@/shared/i18n/I18nContext";
import { formatTestMon } from "../model/athleteRewards";
import type { ProgrammeSelectionProps } from "./ProgrammeDistribution";
import DistributionFlowChart from "./DistributionFlowChart";

export default function ProgrammeFlowChart({ programme, selected, onSelect }: ProgrammeSelectionProps) {
  const { t, locale } = useI18n();
  const league = programme.byId.get("league")!, race = programme.byId.get("race")!;
  const source = [programme.byId.get("programme")!, league, race,
    ...league.children.map(id => programme.byId.get(id)!), ...race.children.map(id => programme.byId.get(id)!)];
  return <DistributionFlowChart nodes={source.map(node => ({ id: node.id, parentId: node.parentId,
    label: node.name ?? t(node.labelKey), amountWei: node.amountWei, tone: node.pot ?? "total",
    amount: t("rewards.programme.amount", { amount: node.amountWei === 0n ? "0" : formatTestMon(node.amountWei.toString(), locale) }) }))}
    selected={selected} onSelect={onSelect} controls="programme-inspector" height={400} />;
}
