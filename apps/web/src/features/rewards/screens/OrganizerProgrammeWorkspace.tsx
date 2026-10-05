import { Settings2, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { RewardProgrammeDraftV2, SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { useI18n } from "@/shared/i18n/I18nContext";
import { workspaceCopy } from "../model/workspaceCopy";
import RewardProgramme from "./RewardProgramme";
import ProgrammeSourceMapping from "./ProgrammeSourceMapping";
import ProgrammeFundingV3 from "./ProgrammeFundingV3";
import OrganizerProgrammeOverview from "./OrganizerProgrammeOverview";
import styles from "../components/RewardWorkspace.module.css";
const PilotAcceptanceV3 = lazy(() => import("../components/PilotAcceptanceV3"));
const OrganizerRewards = lazy(() => import("./OrganizerRewards"));
const sections = ["overview", "rules", "results", "recipients", "funding", "activity"] as const;
type Section = typeof sections[number];

export default function OrganizerProgrammeWorkspace({ record, save, integrated }: {
  record: SavedRewardPlanningDraft; save: (rules: RewardProgrammeDraftV2) => Promise<void>; integrated: boolean;
}) {
  const { t, locale } = useI18n(), copy = workspaceCopy(locale);
  const location = useLocation(), navigate = useNavigate(), search = new URLSearchParams(location.search);
  const requested = search.get("section");
  const anchorSection = location.hash === "#programme-funding" ? "funding" : location.hash === "#source-mapping" ? "rules"
    : location.hash === "#published-preview" ? "results" : location.hash === "#testnet-pilot" ? "activity" : null;
  const section: Section = anchorSection ?? (sections.includes(requested as Section) ? requested as Section : "overview");
  const [visited, setVisited] = useState<Set<Section>>(() => new Set([section]));
  useEffect(() => { setVisited(previous => previous.has(section) ? previous : new Set([...previous, section])); }, [section]);
  function go(next: Section, slot?: number) {
    const query = new URLSearchParams(location.search); query.set("draft", record.draftId); query.set("section", next);
    if (slot !== undefined) query.set("pot", String(slot)); else query.delete("pot");
    navigate({ pathname: location.pathname, search: query.toString(), hash: "" });
  }
  const mounted = (key: Section) => visited.has(key) || section === key;
  const drawer = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = drawer.current;
    if (!element) return;
    if (section === "overview") { if (element.open) element.close(); }
    else if (!element.open) element.showModal();
  }, [section]);
  const hr = locale === "hr";
  const slot = search.get("pot");
  const selectedRound = slot !== null && /^[0-4]$/.test(slot) ? Number(slot) + 1 : undefined;
  const selectedLeague = slot === "5";
  const title = section === "rules" ? (hr ? "Postavke programa" : "Programme settings") : section === "results" ? (selectedRound ? `${hr ? "Pregled raspodjele · Kolo" : "Review distribution · Round"} ${selectedRound}` : selectedLeague ? (hr ? "Pregled raspodjele · Liga" : "Review distribution · League") : hr ? "Pregled raspodjele" : "Review distribution") : copy[section];
  return <div className={styles.page}>
    <header className={styles.header}><div><h1>{record.seasonName}</h1><p>{record.organizationName}</p></div>
      <div className={styles.actions}><Link className={styles.textAction} to="/rewards">{hr ? "Javni pregled" : "Public view"}</Link><button className={styles.secondaryAction} onClick={() => go("rules")}><Settings2 size={16} aria-hidden="true" />{hr ? "Postavke" : "Settings"}</button></div></header>
    <OrganizerProgrammeOverview record={record} navigate={go} />
    <div className={styles.workspaceFooter}><button onClick={() => go("recipients")}>{hr ? "Primatelji i isplate" : "Recipients & payouts"}</button><button onClick={() => go("activity")}>{hr ? "Aktivnost" : "Activity"}</button><span>{copy.revision} {record.revision}</span></div>
    <dialog ref={drawer} className={`${styles.page} ${styles.drawer}`} aria-labelledby="reward-task-title" onCancel={event => { event.preventDefault(); go("overview"); }}>
      <header className={styles.drawerHeading}><h2 id="reward-task-title">{title}</h2><button className={styles.iconAction} aria-label={hr ? "Zatvori" : "Close"} onClick={() => go("overview")}><X size={20} aria-hidden="true" /></button></header>
    {/* Visited editors remain mounted: switching sections never discards unsaved rules or an in-flight action. */}
    <div hidden={section !== "rules"} className={styles.panel}>{mounted("rules") ? <RewardProgramme initialDraft={record.rules} storage={{ record, save }} integrated={integrated} embedded /> : null}</div>
    <div hidden={section !== "rules" && section !== "results"} className={styles.panel}>{mounted("rules") || mounted("results") ? <details open={section === "results" ? true : undefined} className={styles.disclosure}><summary hidden={section === "results"}>{hr ? "Utrke i kategorije" : "Races & categories"}</summary><ProgrammeSourceMapping record={record} selectedRound={selectedRound} selectedLeague={selectedLeague} section={section === "results" ? "results" : "setup"} /></details> : null}</div>
    <div hidden={section !== "funding"} className={styles.panel}>{mounted("funding") ? <ProgrammeFundingV3 record={record} /> : null}</div>
    <div hidden={section !== "recipients"} className={styles.panel}>{mounted("recipients") ? <><h2 className="text-xl font-semibold">{copy.legacyRecipients}</h2><details className={styles.disclosure}><summary>{hr ? "Odabir programa" : "Programme selection"}</summary><p>{copy.legacyHelp}</p></details><Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><OrganizerRewards embedded /></Suspense></> : null}</div>
    <div hidden={section !== "activity"}>{mounted("activity") ? <section className={styles.section}><h2>{copy.activity}</h2><p>{copy.activityHelp}</p>
      <dl className="my-4 space-y-3"><div><dt>{copy.updated}</dt><dd>{new Date(record.updatedAt).toLocaleString(locale)}</dd></div><div><dt>{copy.revision}</dt><dd>{record.revision}</dd></div></dl>
      <p className={styles.muted}>{copy.noRuntime}</p>
      {record.draftId === "9a000000-0000-4000-8000-000000000052" && record.chainId === 10143 ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><PilotAcceptanceV3 /></Suspense> : null}
    </section> : null}</div>
    <details className={styles.disclosure}><summary>{copy.technical}</summary><dl className="mt-3 space-y-2 break-all text-sm"><div><dt>{copy.programmeId}</dt><dd className="font-mono">{record.draftId}</dd></div><div><dt>{t("rewards.fundingV3.revision", { revision: record.revision })}</dt><dd>{record.chainId === 10143 ? "Monad Testnet · 10143" : "Local simulation · 31337"}</dd></div></dl></details>
    </dialog>
  </div>;
}
