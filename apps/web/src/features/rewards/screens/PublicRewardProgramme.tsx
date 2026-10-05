import { Link } from "react-router-dom";
import { useI18n } from "@/shared/i18n/I18nContext";
import styles from "../components/RewardWorkspace.module.css";

/** The former hardcoded demo prospectus has been retired. */
export default function PublicRewardProgramme() {
  const { locale } = useI18n(), hr = locale === "hr";
  return <article className={styles.page}>
    <h1>{hr ? "Program nije pronađen" : "Programme not found"}</h1>
    <p>{hr ? "Ova povijesna poveznica nema objavljen program. Odaberi postojeći događaj ili pregledaj trenutačne kampanje." : "This historical link has no published programme. Choose an existing event or browse current campaigns."}</p>
    <Link className={styles.primaryAction} to="/rewards/events">{hr ? "Odaberi događaj za podršku" : "Choose an event to support"}</Link>
    <Link className={styles.textAction} to="/rewards/campaigns">{hr ? "Pogledaj kampanje" : "View campaigns"}</Link>
  </article>;
}
