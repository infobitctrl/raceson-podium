import { useEffect, useRef, useState, type FormEvent } from "react";
import type { RewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";
import { useI18n } from "@/shared/i18n/I18nContext";
import { draftFromProgrammeForm, programmeForm, type ProgrammeForm } from "../model/programmeForm";
import { buildProgrammeOverview, rewardProgrammeRounds } from "../model/programmeOverview";
import { formatTestMon } from "../model/athleteRewards";
import ProgrammePrizeCurve from "./ProgrammePrizeCurve";
import styles from "../screens/RewardProgramme.module.css";

const stepKeys = ["rewards.design.budgetStep", "rewards.design.awardsStep", "rewards.design.reviewStep"] as const;
export default function ProgrammeSettings({ draft, onApply, onClose }: {
  draft: RewardProgrammeDraftV2; onApply: (value: RewardProgrammeDraftV2) => void; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [form, setForm] = useState(() => programmeForm(draft));
  const [step, setStep] = useState(0);
  const [error, setError] = useState(false);
  const [curve, setCurve] = useState<"raceWeights" | "leagueWeights">("raceWeights");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  let candidate: RewardProgrammeDraftV2 | null = null;
  try { candidate = draftFromProgrammeForm(form); } catch { /* Incomplete inputs are never previewed as valid. */ }
  const preview = candidate ? buildProgrammeOverview(candidate) : null;
  const amount = (wei: bigint) => t("rewards.programme.amount", { amount: wei === 0n ? "0" : formatTestMon(wei.toString(), locale) });
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      // Returning to budget must not validate unfinished award edits on a hidden step.
      const next = draftFromProgrammeForm(step === 0 ? { ...programmeForm(draft),
        budgetMon: form.budgetMon, league: form.league, rounds: form.rounds } : form);
      setError(false);
      if (step < 2) setStep(step + 1); else onApply(next);
    } catch { setError(true); }
  }
  function scalar(key: "budgetMon" | "league", value: string) {
    setForm(previous => ({ ...previous, [key]: value })); setError(false);
  }
  function list(key: Exclude<keyof ProgrammeForm, "budgetMon" | "league">, index: number, value: string) {
    setForm(previous => ({ ...previous, [key]: previous[key].map((entry, i) => i === index ? value : entry) }));
    setError(false);
  }
  const families = [t("rewards.planner.athleteStandings"), t("rewards.planner.clubStandings"), t("rewards.planner.participation")];
  return <form className={styles.settings} onSubmit={submit} aria-label={t("rewards.planner.settings")} noValidate>
    <ol className={styles.setupSteps} aria-label={t("rewards.planner.settings")}>{stepKeys.map((key, index) =>
      <li key={key} aria-current={step === index ? "step" : undefined}>{index + 1} · {t(key)}</li>)}</ol>
    <h2 ref={heading} tabIndex={-1}>{t(stepKeys[step])}</h2>
    <p className={styles.settingsIntro}>{t("rewards.planner.presets")}</p>
    <div className={styles.settingsGrid}><div>
      <div hidden={step !== 0}>
        <label className={styles.field}>{t("rewards.planner.budget")}
          <input inputMode="decimal" value={form.budgetMon} maxLength={100} onChange={event => scalar("budgetMon", event.target.value)} />
        </label>
        <fieldset><legend>{t("rewards.planner.programmeSplit")}</legend>
          <p className={styles.settingsHelp}>{t("rewards.design.splitHelp")}</p><div className={styles.fieldGrid}>
          <label className={styles.field}>{t("rewards.programme.leaguePot")}
            <input inputMode="decimal" maxLength={6} value={form.league} onChange={event => scalar("league", event.target.value)} />
          </label>
          {rewardProgrammeRounds.map((round, index) => <label key={round.id} className={styles.field}>
            {t("rewards.programme.round", { number: round.number })} · {round.name}
            <input inputMode="decimal" maxLength={6} value={form.rounds[index]} onChange={event => list("rounds", index, event.target.value)} />
          </label>)}
        </div></fieldset>
      </div>
      <div hidden={step !== 1}>
        {(["raceFamilies", "leagueFamilies"] as const).map(key => <fieldset key={key}>
          <legend>{t(key === "raceFamilies" ? "rewards.planner.raceFamilies" : "rewards.planner.leagueFamilies")}</legend>
          <div className={styles.fieldGrid}>{form[key].map((value, index) => <label className={styles.field} key={index}>
            {families[index]}<input inputMode="decimal" maxLength={6} value={value} onChange={event => list(key, index, event.target.value)} />
          </label>)}</div>
        </fieldset>)}
        <div role="group" className={styles.curveSwitch} aria-label={t("rewards.planner.curveTitle")}>
          {(["raceWeights", "leagueWeights"] as const).map(key => <button key={key} type="button" aria-pressed={curve === key}
            onClick={() => setCurve(key)}>{t(key === "raceWeights" ? "rewards.planner.raceCurve" : "rewards.planner.leagueCurve")}</button>)}
        </div>
        {candidate ? <ProgrammePrizeCurve weights={curve === "raceWeights" ? candidate.raceRankWeights : candidate.leagueRankWeights} /> : null}
        <details className={styles.rules}><summary>{t("rewards.design.editWeights")}</summary>
          <p>{t("rewards.planner.weightHelp")}</p>
          {(["raceWeights", "leagueWeights"] as const).map(key => <fieldset key={key} hidden={curve !== key}>
            <legend>{t(key === "raceWeights" ? "rewards.planner.raceCurve" : "rewards.planner.leagueCurve")}</legend>
            <div className={styles.fieldGrid}>{form[key].map((value, index) => <label className={styles.field} key={index}>
              {t("rewards.planner.rankWeight", { rank: index + 1 })}
              <input inputMode="numeric" maxLength={7} value={value} onChange={event => list(key, index, event.target.value)} />
            </label>)}</div>
          </fieldset>)}
        </details>
      </div>
      <div hidden={step !== 2} className={styles.planReview}>
        <h3>{t("rewards.design.reviewTitle")}</h3><p>{t("rewards.design.reviewHelp")}</p>
        <dl><dt>{t("rewards.planner.raceCurve")}</dt><dd>{form.raceWeights.length}</dd>
          <dt>{t("rewards.planner.leagueCurve")}</dt><dd>{form.leagueWeights.length}</dd>
          <dt>{t("rewards.design.reviewPolicy")}</dt><dd>{t("rewards.design.reviewSeparate")}</dd></dl>
        <p>{t("rewards.planner.curveHelp")}</p>
      </div>
      {error ? <p role="alert" className={styles.formError}>{t("rewards.planner.error")}</p> : null}
      <div className={styles.actions}>
        {step > 0 ? <button type="button" onClick={() => { setError(false); setStep(step - 1); }}>{t("rewards.design.back")}</button> : null}
        <button type="submit" className={styles.primaryAction}>{t(step === 2 ? "rewards.planner.apply" : "rewards.design.continue")}</button>
        <button type="button" onClick={onClose}>{t("rewards.planner.cancel")}</button>
      </div>
    </div><aside className={styles.settingsPreview} aria-label={t("rewards.design.preview")}>
      <h3>{t("rewards.design.preview")}</h3>
      {preview ? <><p className={styles.previewTotal}>{amount(preview.budgetWei)}</p>
        <ul>{["league", ...rewardProgrammeRounds.map(round => round.id)].map(id => {
          const node = preview.byId.get(id)!;
          return <li key={id}><span>{node.name ?? t(node.labelKey)}</span><strong>{amount(node.amountWei)}</strong></li>;
        })}</ul><p>{t("rewards.design.previewOnly")}</p>
      </> : <p role="status">{t("rewards.design.invalidPreview")}</p>}
    </aside></div>
  </form>;
}
