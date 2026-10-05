import { ArrowRight, ChevronRight } from "lucide-react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { createDefaultRewardProgrammeDraftV2, type RewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { Link, useSearchParams } from "react-router-dom";
import { useI18n } from "@/shared/i18n/I18nContext";
import { formatTestMon } from "../model/athleteRewards";
import { buildProgrammeOverview, programmePath, programmePresentation, programmeSelection, type ProgrammeNode } from "../model/programmeOverview";
import ProgrammeDistribution, { type ProgrammeSelectionProps } from "../components/ProgrammeDistribution";
import ProgrammePrizeCurve from "../components/ProgrammePrizeCurve";
import ProgrammePortalFrame from "../components/ProgrammePortalFrame";
import styles from "./RewardProgramme.module.css";
import workspaceStyles from "../components/RewardWorkspace.module.css";

const ProgrammeSettings = lazy(() => import("../components/ProgrammeSettings"));
const steps = ["results", "review", "wallet", "payment"] as const;

function useProgrammeLabels() {
  const { t, locale } = useI18n();
  return {
    t,
    label: (node: ProgrammeNode) => node.name ?? t(node.labelKey, { number: node.roundNumber ?? "" }),
    amount: (wei: bigint) => t("rewards.programme.amount", { amount: wei === 0n ? "0" : formatTestMon(wei.toString(), locale) }),
  };
}

type SelectionProps = ProgrammeSelectionProps;

function AllocationInspector({ selected, onSelect, programme, hasLedger = false }: SelectionProps & { hasLedger?: boolean }) {
  const { t, label, amount } = useProgrammeLabels();
  const node = programme.byId.get(selected)!;
  const path = programmePath(selected, programme);
  return <section id="programme-inspector" className={styles.inspector} aria-label={t("rewards.programme.detail")} data-pot={node.pot}>
    <nav aria-label={t("rewards.programme.breadcrumb")} className={styles.breadcrumb}>
      {path.slice(0, -1).map(parent => <button type="button" key={parent.id} onClick={() => onSelect(parent.id)}>
        {label(parent)}<ChevronRight size={12} aria-hidden="true" />
      </button>)}
    </nav>
    <div aria-live="polite" aria-atomic="true">
      <h2>{label(node)}</h2>
      <p className={styles.inspectorAmount}>{amount(node.amountWei)}</p>
      <p className={styles.status}>{t(hasLedger ? "rewards.pilot.planningOnly" : "rewards.programme.awaiting")}</p>
    </div>
    {node.children.length ? <ul className={styles.allocations}>
      {node.children.map(id => {
        const child = programme.byId.get(id)!;
        const share = node.amountWei ? Number(child.amountWei * 10_000n / node.amountWei) / 100 : 0;
        return <li key={id}><button type="button" onClick={() => onSelect(id)}>
          <span className={styles.allocationLabel}><span>{label(child)}</span><strong>{amount(child.amountWei)}</strong></span>
          <span className={styles.bar} aria-hidden="true"><span style={{ width: `${share}%` }} /></span>
        </button></li>;
      })}
    </ul> : null}
    <div className={styles.evidence}>
      <details key={`rules:${selected}`} className={styles.rules}>
        <summary>{t("rewards.programme.rules")}</summary>
        <p>{t(node.ruleKey)}</p>
      </details>
      <details className={styles.rules}>
        <summary>{t("rewards.programme.evidence")}</summary>
        <p>{t(hasLedger ? "rewards.pilot.planningEvidence" : "rewards.programme.noAwards")}</p><p>{t(node.evidenceKey)}</p>
        {node.roundNumber === 5 ? <p>{t("rewards.planner.evidence.replacement")}</p> : null}
      </details>
      {node.rankWeights ? <details className={styles.rules}><summary>{t("rewards.planner.curveTitle")}</summary>
        <p>{t("rewards.planner.curveHelp")}</p><ProgrammePrizeCurve key={`curve:${node.id}`} weights={node.rankWeights} />
      </details> : null}
    </div>
    <details className={styles.chainStatus}><summary>{t("rewards.design.contractEvidence")}</summary>
      {hasLedger ? <><p>{t("rewards.pilot.planningEvidence")}</p>
        <a href="#programme-funding">{t("rewards.fundingV3.title")}</a></> : <>
        <p>{t("rewards.planner.funding")}</p><p>{t("rewards.planner.contract")}</p><p>{t("rewards.planner.payments")}</p></>}
    </details>
  </section>;
}

export default function RewardProgramme({ initialDraft, storage, integrated = false, embedded = false }: {
  initialDraft?: RewardProgrammeDraftV2;
  storage?: { record: SavedRewardPlanningDraft; save: (draft: RewardProgrammeDraftV2) => Promise<void> };
  integrated?: boolean; embedded?: boolean;
}) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState(() => initialDraft ?? createDefaultRewardProgrammeDraftV2());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<"conflict" | "failed" | null>(null);
  const dirty = Boolean(storage && JSON.stringify(draft) !== JSON.stringify(storage.record.rules));
  async function save() {
    if (!storage || saving) return;
    setSaving(true); setSaveError(null);
    try { await storage.save(draft); }
    catch (error) { setSaveError(error && typeof error === "object" && "code" in error && error.code === "reward_planning_revision_changed" ? "conflict" : "failed"); }
    finally { setSaving(false); }
  }
  const programme = useMemo(() => buildProgrammeOverview(draft), [draft]);
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useSearchParams();
  const selected = programmeSelection(search, programme);
  const presentation = programmePresentation(search);
  function changeView(view: "standalone" | "portal", node = selected) {
    const next = new URLSearchParams();
    next.set("node", node);
    if (storage) { next.set("draft", storage.record.draftId); if (search.has("section")) next.set("section", search.get("section")!); }
    else if (view === "portal") next.set("view", view);
    setSearch(next);
  }
  function closeSettings() { setEditing(false); editButton.current?.focus(); }
  // Only public navigation keys go in the URL. No auth, wallet or private award
  // state is persisted. React Router owns back/reload; no syncing effect needed.
  const onSelect = (id: string) => {
    if (programme.byId.has(id) && id !== selected) changeView(presentation, id);
  };
  if (embedded && storage) return <section className={workspaceStyles.panel}>
    <div className={workspaceStyles.sectionHeading}><h2>{t("rewards.design.budgetStep")} · {t("rewards.design.awardsStep")}</h2><span className={workspaceStyles.muted}>{t(dirty ? "rewards.saved.unsaved" : "rewards.saved.revision", { revision: storage.record.revision })}</span></div>
    <dl className={workspaceStyles.fundingStrip}><div><dt>{t("rewards.planner.budget")}</dt><dd className="text-xl font-semibold">{draft.budgetMon}</dd></div><div><dt>{t("rewards.reviewV3.hours")}</dt><dd className="text-xl font-semibold">{draft.reviewSeconds / 3600}</dd></div></dl>
    <div className={`${workspaceStyles.actions} my-4`}>
      <button type="button" disabled={saving} ref={editButton} aria-expanded={editing} className={workspaceStyles.secondaryAction} onClick={() => setEditing(value => !value)}>{t("rewards.planner.configure")}</button>
      <button type="button" className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" disabled={saving || editing || !dirty} onClick={() => void save()}>{t(saving ? "rewards.saved.saving" : "rewards.saved.save")}</button>
    </div>
    {saveError ? <p role="alert" className={styles.formError}>{t(saveError === "conflict" ? "rewards.saved.conflict" : "rewards.saved.saveError")}</p> : null}
    {editing ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><ProgrammeSettings draft={draft} onApply={next => { setDraft(next); closeSettings(); }} onClose={closeSettings} /></Suspense> : null}
  </section>;
  return <div className={`${styles.page} ${embedded ? workspaceStyles.embedded : ""}`}>
    <div className={styles.container}>
      <details className={styles.toolbar}><summary>{t("rewards.visual.presentation")}</summary>
        {!storage ? <div role="group" aria-label={t("rewards.planner.presentation")} className={styles.modeSwitch}>
          <button type="button" aria-pressed={presentation === "standalone"} onClick={() => changeView("standalone")}>{t("rewards.planner.standalone")}</button>
          <button type="button" aria-pressed={presentation === "portal"} onClick={() => changeView("portal")}>{t("rewards.planner.portal")}</button>
        </div> : <strong>{t(integrated ? "rewards.saved.portal" : "rewards.saved.standalone")}</strong>}
      </details>
      <ProgrammePortalFrame active={!storage && presentation === "portal"} selected={selected} onSelect={onSelect}>
      <header className={styles.heading} hidden={embedded}>
        <div><p className={styles.kicker}>{t("rewards.premium.eyebrow")}</p><h1>{storage?t("rewards.programme.title"):locale==="hr"?"Primjer kalkulatora raspodjele":"Example allocation calculator"}</h1><p className={styles.heroIntro}>{t("rewards.programme.intro")}</p></div>
        <aside className={styles.heroAside}><strong>{t("rewards.premium.asideTitle")}</strong><p>{t("rewards.premium.asideHelp")}</p><span>{t(storage ? "rewards.saved.badge" : "rewards.planner.preview")}</span></aside>
      </header>
      <p className={styles.previewNotice}>{!storage?<><strong>{locale==="hr"?"Povijesni primjer · nije aktualni katalog događaja.":"Historical example · not the current event catalogue."}</strong> {locale==="hr"?"Broj kola, datumi i iznosi ilustriraju ovaj primjer. Za novu kampanju odaberite postojeći događaj.":"The round count, dates and amounts illustrate this example. Choose an existing event to start a new campaign."} <Link to="/rewards/events">{locale==="hr"?"Odaberite događaj":"Choose an event"}</Link><br/></>:null}{t(storage ? "rewards.saved.notice" : "rewards.planner.notice")}</p>
      {storage ? <div className={styles.previewNotice}>
        <strong>{storage.record.organizationName} / {storage.record.seasonName}</strong>
        <p role="status">{t(dirty ? "rewards.saved.unsaved" : "rewards.saved.revision", { revision: storage.record.revision })}</p>
        <p className="break-all font-mono text-xs">{storage.record.draftId}</p>
      </div> : presentation === "portal" ? <p className={styles.previewNotice}>{t("rewards.planner.portalNotice")}</p> : null}
      <div className={styles.actions}>
        <button type="button" disabled={saving} ref={editButton} aria-expanded={editing} aria-controls="programme-settings" className={styles.primaryAction}
          onClick={() => setEditing(value => !value)}>{t("rewards.planner.configure")}<ArrowRight size={18} aria-hidden="true" /></button>
        <button type="button" disabled={saving} onClick={() => { setDraft(createDefaultRewardProgrammeDraftV2()); closeSettings(); }}>{t("rewards.planner.reset")}</button>
        {storage ? <button type="button" className={styles.primaryAction} disabled={saving || editing || !dirty} onClick={() => void save()}>{t(saving ? "rewards.saved.saving" : "rewards.saved.save")}</button> : null}
      </div>
      {saveError ? <p role="alert" className={styles.formError}>{t(saveError === "conflict" ? "rewards.saved.conflict" : "rewards.saved.saveError")}</p> : null}
      {editing ? <div id="programme-settings"><Suspense fallback={<p role="status">{t("rewards.loading")}</p>}>
        <ProgrammeSettings draft={draft} onApply={next => { setDraft(next); closeSettings(); }} onClose={closeSettings} />
      </Suspense></div> : null}
      <div className={styles.workbench} hidden={editing}>
        <ProgrammeDistribution selected={selected} onSelect={onSelect} programme={programme} />
        <AllocationInspector selected={selected} onSelect={onSelect} programme={programme} hasLedger={Boolean(storage)} />
      </div>
      <section className={styles.workflow} hidden={editing} aria-labelledby="programme-workflow-heading">
        <h2 id="programme-workflow-heading">{t("rewards.programme.workflow")}</h2>
        <ol>{steps.map((step, index) => <li key={step}>
          <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
          <div><h3>{t(step === "review" ? "rewards.design.reviewPolicy" : `rewards.programme.step.${step}`)}</h3><p>{t(step === "review" ? "rewards.design.reviewPolicyHelp" : `rewards.programme.step.${step}Help`)}</p></div>
          {index < steps.length - 1 ? <ChevronRight size={20} className={styles.stepArrow} aria-hidden="true" /> : null}
        </li>)}</ol>
      </section>
      <section className={styles.contractExplanation} hidden={editing} aria-labelledby="programme-contract-heading">
        <h2 id="programme-contract-heading">{t("rewards.design.contractTitle")}</h2>
        <p>{t("rewards.design.contractHelp")}</p>
      </section>
      <footer className={styles.footer} hidden={editing}>
        <div><strong>{t("rewards.programme.notMerkle")}</strong><p>{t("rewards.programme.commitment")}</p></div>
        <nav aria-label={t("rewards.demo.navigation")}>
          <Link to="/athlete/rewards">{t("rewards.programme.myRewards")}<ArrowRight size={18} aria-hidden="true" /></Link>
          <Link to="/organizer/rewards">{t("rewards.programme.organizerLink")}<ArrowRight size={18} aria-hidden="true" /></Link>
        </nav>
      </footer>
      </ProgrammePortalFrame>
    </div>
  </div>;
}
