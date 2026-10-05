import { useId, useState } from "react";
import type { RewardSportingSource, RewardSportingRow } from "@raceson/domain/rewards";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { sportingGroups, sportingMembers, selectedSportingRows, suggestSportingRanks, sportingTime, type SportingDraft } from "../model/organizerSportingDraft";
import { organizerUuid } from "../model/organizerRewards";

const inputClass = "min-w-0 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";
function Runner({ row }: { row: RewardSportingRow }) {
  const { t, locale } = useI18n(); return <><span className="break-words font-medium">{row.athleteName ?? t("rewards.distribution.unnamed")}</span>
    <span className="block text-xs text-muted-foreground">{BigInt(row.distanceMetres).toLocaleString(locale)} m · {sportingTime(row.finishTimeMs)}</span></>;
}
/** Sporting decisions only. No automatic age guess, duplicate exclusion or payment. */
export default function SportingReviewEditor({ source, draft, disabled, onChange, onRecord, onReviewRecord }: { source: RewardSportingSource;
  draft: SportingDraft; disabled: boolean; onChange: (next: SportingDraft) => void; onRecord: (raceId: string, gender: "M" | "F", approvalId: string) => void;
  onReviewRecord: (raceId: string, gender: "M" | "F") => void }) {
  const { t, locale } = useI18n(), [approvalIds, setApprovalIds] = useState<Record<string, string>>({}), referenceHelpId = useId();
  const groups = sportingGroups(source), selected = selectedSportingRows(source, draft), uncertain = selected.filter(r => r.possibleClassificationIds.length > 0);
  const className = (id: string) => source.classifications.find(c => c.id === id)?.name ?? id;
  const change = (patch: Partial<SportingDraft>, resetRanks = false) => onChange({ ...draft, ...patch, ...(resetRanks ? { ranks: {} } : {}) });
  return <fieldset disabled={disabled} className="min-w-0 space-y-6">
    <legend className="mb-3 text-lg font-semibold">{t("rewards.sporting.decisions")}</legend>
    {source.pot === "race" ? <div className="space-y-2"><label className="block space-y-2 text-sm"><span>{t("rewards.sporting.reference")}</span>
      <input className={inputClass} aria-describedby={referenceHelpId} value={draft.reference} maxLength={100} onChange={e => change({ reference: e.target.value })} /></label>
      <p id={referenceHelpId} className="text-xs text-muted-foreground">{t("rewards.sporting.referenceHelp")}</p></div> : null}
    <details className="rounded-xl border p-4" open={source.duplicateGroupCount > 0 ? true : undefined}>
      <summary className="cursor-pointer font-semibold">{t("rewards.sporting.selection")}</summary>
      <p className="my-3 text-sm text-muted-foreground">{t("rewards.sporting.selectionHelp")}</p>
      <div className="space-y-3">{groups.map(g => {
        const decision = draft.selections[g.key] ?? { selected: g.rows.length === 1 ? g.rows[0].sourceId : "", evidence: "" };
        const needsEvidence = g.rows.length > 1 || decision.selected === "exclude";
        return <article key={g.key} className="min-w-0 space-y-3 rounded-lg bg-muted/30 p-3">
          <p><Runner row={g.rows[0]} /></p><p className="text-xs">{t("rewards.distribution.round", { number: source.rounds.find(r => r.id === g.rows[0].roundId)!.number })}</p>
          <label className="block space-y-1 text-sm"><span>{t("rewards.sporting.chooseFinish")}</span>
            <select className={inputClass} value={decision.selected} onChange={e => change({ selections: { ...draft.selections, [g.key]: { ...decision, selected: e.target.value } } }, true)}>
              <option value="">{t("rewards.sporting.unreviewed")}</option>
              {g.rows.map(r => <option key={r.sourceId} value={r.sourceId}>{BigInt(r.distanceMetres).toLocaleString(locale)} m · {sportingTime(r.finishTimeMs)} · {r.sourceId}</option>)}
              <option value="exclude">{t("rewards.sporting.exclude")}</option>
            </select></label>
          {needsEvidence ? <label className="block space-y-1 text-sm"><span>{t("rewards.sporting.caseRef")}</span><input className={inputClass} value={decision.evidence} maxLength={100}
            onChange={e => change({ selections: { ...draft.selections, [g.key]: { ...decision, evidence: e.target.value } } })} /></label> : null}
        </article>;
      })}</div>
    </details>
    {source.pot === "race" ? <>
      <section className="space-y-3" aria-label={t("rewards.sporting.memberships")}><h3 className="font-semibold">{t("rewards.sporting.memberships")}</h3>
        <p className="text-sm text-muted-foreground">{t("rewards.sporting.membershipsHelp")}</p>
        {uncertain.length === 0 ? <p className="text-sm">{t("rewards.sporting.noUncertain")}</p> : uncertain.map(r => {
          const decision = draft.memberships[r.sourceId] ?? { classification: "", evidence: "" };
          return <article className="min-w-0 space-y-3 rounded-xl border p-4" key={r.sourceId}><p><Runner row={r} /></p>
            <label className="block space-y-1 text-sm"><span>{t("rewards.sporting.classification")}</span><select className={inputClass} value={decision.classification}
              onChange={e => change({ memberships: { ...draft.memberships, [r.sourceId]: { ...decision, classification: e.target.value } } }, true)}>
              <option value="">{t("rewards.sporting.unreviewed")}</option><option value="none">{t("rewards.sporting.noMembership")}</option>
              {r.possibleClassificationIds.map(id => <option key={id} value={id}>{className(id)} · {id}</option>)}
            </select></label>
            <label className="block space-y-1 text-sm"><span>{t("rewards.sporting.caseRef")}</span><input className={inputClass} value={decision.evidence} maxLength={100}
              onChange={e => change({ memberships: { ...draft.memberships, [r.sourceId]: { ...decision, evidence: e.target.value } } })} /></label>
          </article>;
        })}
      </section>
      <section className="space-y-3" aria-label={t("rewards.sporting.podiums")}><h3 className="font-semibold">{t("rewards.sporting.podiums")}</h3>
        <p className="text-sm text-muted-foreground">{t("rewards.sporting.podiumsHelp")}</p>
        <Button variant="outline" className="h-auto whitespace-normal" onClick={() => change({ ranks: suggestSportingRanks(source, draft) })}>{t("rewards.sporting.suggestRanks")}</Button>
        {source.classifications.map(c => { const members = sportingMembers(source, draft, c.id); return <details className="min-w-0 space-y-3 rounded-xl border p-4" key={c.id}>
          <summary className="cursor-pointer break-words font-semibold">{c.name ?? c.id} · {members.length}</summary>
          <p className="break-all text-xs text-muted-foreground">{c.id}</p>
          {members.map(r => <label className="flex flex-wrap items-center justify-between gap-3 border-t py-3 text-sm" key={r.sourceId}>
            <span className="min-w-0"><Runner row={r} /><span className="block text-xs">{t("rewards.sporting.rank")}</span></span>
            <input aria-label={`${t("rewards.sporting.rank")} · ${r.athleteName ?? r.athleteId} · ${c.id}`} className={`${inputClass} !w-24`} inputMode="numeric"
              value={draft.ranks[c.id]?.[r.sourceId] ?? ""} maxLength={5}
              onChange={e => change({ ranks: { ...draft.ranks, [c.id]: { ...draft.ranks[c.id], [r.sourceId]: e.target.value } } })} />
          </label>)}
          {!members.length ? <p className="text-sm text-muted-foreground">{t("rewards.sporting.emptyClassification")}</p> : null}
        </details>; })}
      </section>
      <section className="space-y-3" aria-label={t("rewards.sporting.records")}><h3 className="font-semibold">{t("rewards.sporting.records")}</h3>
        <p className="text-sm text-muted-foreground">{t("rewards.sporting.recordsHelp")}</p>
        <div className="grid gap-3 sm:grid-cols-2">{source.rounds[0].races.flatMap(race => (["M", "F"] as const).map(gender => {
          const id = `${race.id}:${gender}`, record = draft.records[id];
          return <article key={id} className="min-w-0 space-y-3 rounded-xl border p-4">
            <h4 className="font-semibold">{BigInt(race.distanceMetres).toLocaleString(locale)} m · {t(gender === "M" ? "rewards.sporting.men" : "rewards.sporting.women")}</h4>
            <label className="block space-y-1 text-sm"><span>{t("rewards.sporting.recordDecision")}</span><select className={inputClass} value={record?.choice ?? ""}
              onChange={e => { const records = { ...draft.records }; if (!e.target.value) delete records[id];
                else records[id] = { choice: e.target.value as "none" | "approved", approval: null }; change({ records }); }}>
              <option value="">{t("rewards.sporting.unreviewed")}</option><option value="none">{t("rewards.sporting.noRecord")}</option>
              <option value="approved">{t("rewards.sporting.useRecord")}</option>
            </select></label>
            <Button variant="outline" className="h-auto whitespace-normal" onClick={() => onReviewRecord(race.id, gender)}>{t("rewards.records.open")}</Button>
            {record?.choice === "approved" ? <><label className="block space-y-1 text-sm"><span>{t("rewards.sporting.approvalId")}</span>
              <input className={inputClass} maxLength={36} value={approvalIds[id] ?? ""} onChange={e => { setApprovalIds(old => ({ ...old, [id]: e.target.value }));
                change({ records: { ...draft.records, [id]: { choice: "approved", approval: null } } }); }} /></label>
              <Button variant="outline" className="h-auto whitespace-normal" disabled={disabled || !organizerUuid(approvalIds[id])} onClick={() => onRecord(race.id, gender, approvalIds[id])}>{t("rewards.sporting.loadRecord")}</Button>
              {record.approval ? <p className="text-sm" role="status">{t("rewards.sporting.recordLoaded", { time: sportingTime(record.approval.baseline.finishTimeMs) })}</p> : null}
            </> : null}
          </article>;
        }))}</div>
      </section>
    </> : <p className="rounded-xl border p-4 text-sm">{t("rewards.sporting.leagueHelp")}</p>}
  </fieldset>;
}
