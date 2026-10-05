import {
  ExternalLink,
} from "lucide-react";
import {
  getOrganizationSocialLinks,
  type OrganizationSocialProfile,
} from "./publicOrganizationSocialLinks";

export function OrganizationSocialLinks({
  organization,
  linkClassName,
  iconClassName = "h-3.5 w-3.5 text-primary",
  showExternalIcon = false,
}: {
  organization: OrganizationSocialProfile;
  linkClassName: string;
  iconClassName?: string;
  showExternalIcon?: boolean;
}) {
  return getOrganizationSocialLinks(organization).map((item) => (
    <a
      key={item.key}
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      className={linkClassName}
    >
      <item.icon className={iconClassName} />
      <span>{item.label}</span>
      {showExternalIcon ? <ExternalLink className="h-3 w-3 text-muted-foreground" /> : null}
    </a>
  ));
}
