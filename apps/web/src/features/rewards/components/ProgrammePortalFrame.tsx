import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";
import { useI18n } from "@/shared/i18n/I18nContext";
import { rewardProgrammeRounds } from "../model/programmeOverview";
import styles from "../screens/RewardProgramme.module.css";

/** Demo-only presentation frame. No fake account, organization role or backend. */
export default function ProgrammePortalFrame({ active, selected, onSelect, children }: {
  active: boolean; selected: string; onSelect: (id: string) => void; children: ReactNode;
}) {
  const { t } = useI18n();
  return <div className={active ? styles.portal : undefined}>
    <aside className={styles.portalSidebar} hidden={!active} aria-label={t("rewards.planner.portalTitle")}>
      <p className={styles.workspaceLabel}>{t("workspace.organizerLabel")}</p>
      <h2><Trophy size={18} aria-hidden="true" />{t("rewards.planner.leagueName")}</h2>
      <nav aria-label={t("rewards.programme.navigation")}>
        {(["programme", "league", "race"] as const).map(id => <button type="button" key={id}
          aria-pressed={selected === id} onClick={() => onSelect(id)}>
          {t(id === "programme" ? "rewards.programme.pot" : id === "league" ? "rewards.programme.leaguePot" : "rewards.programme.racePot")}
        </button>)}
        {rewardProgrammeRounds.map(round => <button type="button" key={round.id}
          aria-pressed={selected === round.id || selected.startsWith(round.id + ":")} onClick={() => onSelect(round.id)}>
          <span>{String(round.number).padStart(2, "0")}</span>{round.name}
        </button>)}
      </nav>
      <div className={styles.portalLinks}>
        <Link to="/athlete/rewards">{t("rewards.programme.myRewards")}</Link>
        <Link to="/club/rewards">{t("rewards.club.title")}</Link>
      </div>
      <p className={styles.portalNotice}>{t("rewards.planner.portalNotice")}</p>
    </aside>
    <div className={styles.portalContent}>{children}</div>
  </div>;
}
