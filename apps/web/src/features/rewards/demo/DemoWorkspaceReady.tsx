import { Outlet } from "react-router-dom";
import { useOrganizerWorkspace } from "@/lib/organizer-workspace";
import { useI18n } from "@/shared/i18n/I18nContext";

/** The reused classic provider restores the tab's workspace in an effect.
 * Do not mount data-fetching demo pages against its transient first-org fallback. */
export default function DemoWorkspaceReady() {
  const workspace = useOrganizerWorkspace();
  const { t } = useI18n();
  if (workspace.organizations.length && !workspace.isPlatformSupportMode && !workspace.defaultOrganizationId) {
    return <p role="status" className="p-6">{t("rewards.loading")}</p>;
  }
  return <Outlet />;
}
