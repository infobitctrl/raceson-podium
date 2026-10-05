import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useI18n } from "@/shared/i18n/I18nContext";
import { portalCopy, presentationLink } from "./portalLinks";

/** Keep the child in the same React position across presentation changes.
 * Selected receipts and shared consent guards belong to that child. */
export default function ClassicRewardFrame({ children }: { children: ReactNode }) {
  const { locale } = useI18n(), copy = portalCopy(locale), location = useLocation();
  const classic = new URLSearchParams(location.search).get("experience") === "classic";
  return <div data-reward-experience={classic ? "classic" : "standalone"}>
    {classic ? <nav className="mx-auto max-w-6xl px-6 pt-3 text-xs" aria-label={copy.context}>
      <Link className="text-muted-foreground underline" to={presentationLink(location.pathname, location.search, location.hash, false)}>{copy.standalone}</Link>
    </nav> : <div hidden />}
    <div>{children}</div>
  </div>;
}
