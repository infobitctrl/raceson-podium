import { useId } from "react";
import { useI18n } from "@/shared/i18n/I18nContext";
import { comparisonChoices, type RecordComparisonDraft } from "../model/organizerRecords";

const inputClass = "min-w-0 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";
export default function RecordComparisonEditor({ value, disabled, onChange }: { value: RecordComparisonDraft; disabled: boolean; onChange: (next: RecordComparisonDraft) => void }) {
  const { t } = useI18n(), helpId = useId();
  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-xl border p-4">
    <legend className="px-1 font-semibold">{t("rewards.records.comparison")}</legend><p className="text-sm text-muted-foreground">{t("rewards.records.comparisonHelp")}</p>
    <div className="grid gap-3 sm:grid-cols-2">{comparisonChoices.map(field => {
      const choices: readonly ("forward" | "reverse" | "manual" | "electronic" | "gun" | "net")[] | null = field.endsWith("Direction") ? ["forward", "reverse"] as const : field.endsWith("TimingMethod") ? ["manual", "electronic"] as const
        : field.endsWith("TimingBasis") ? ["gun", "net"] as const : null;
      const id = `${helpId}-${field}`;
      return <div key={field} className="min-w-0 space-y-1 text-sm"><label className="block" htmlFor={id}>{t(`rewards.records.${field}`)}</label>
        <select id={id} className={inputClass} value={value[field]} onChange={e => onChange({ ...value, [field]: e.target.value })}>
          <option value="">{t("rewards.sporting.unreviewed")}</option>
          {choices ? choices.map(choice => <option key={choice} value={choice}>{t(`rewards.records.${choice}`)}</option>)
            : [1, 10, 100, 1000].map(ms => <option key={ms} value={ms}>{ms} ms</option>)}
        </select></div>;
    })}</div>
    {(["courseEquivalent", "historyReviewed", "exceptionsReviewed"] as const).map(field => <label key={field} className="flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={value[field]} onChange={e => onChange({ ...value, [field]: e.target.checked })} />
      <span>{t(`rewards.records.${field}`)}</span></label>)}
    <label className="block space-y-1 text-sm"><span>{t("rewards.records.rationale")}</span><textarea className={`${inputClass} min-h-24`} maxLength={4000}
      aria-describedby={helpId} value={value.rationale} onChange={e => onChange({ ...value, rationale: e.target.value })} /></label>
    <p id={helpId} className="text-xs text-muted-foreground">{t("rewards.records.rationaleHelp")}</p>
  </fieldset>;
}
