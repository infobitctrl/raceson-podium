import {
  AtSign,
  Facebook,
  Instagram,
  Linkedin,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import type { PublicOrganizationProfile } from "@/lib/portal-data";

export type OrganizationSocialProfile = Pick<
  PublicOrganizationProfile,
  | "instagramUrl"
  | "facebookUrl"
  | "linkedinUrl"
  | "youtubeUrl"
  | "tiktokUrl"
  | "xUrl"
>;

type OrganizationSocialLink = {
  key: keyof OrganizationSocialProfile;
  label: string;
  href: string;
  icon: LucideIcon;
};

const socialLinkDefinitions: Array<{
  key: keyof OrganizationSocialProfile;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "instagramUrl", label: "Instagram", icon: Instagram },
  { key: "facebookUrl", label: "Facebook", icon: Facebook },
  { key: "linkedinUrl", label: "LinkedIn", icon: Linkedin },
  { key: "youtubeUrl", label: "YouTube", icon: Youtube },
  { key: "tiktokUrl", label: "TikTok", icon: AtSign },
  { key: "xUrl", label: "X", icon: AtSign },
];

export function getOrganizationSocialLinks(
  organization: OrganizationSocialProfile,
): OrganizationSocialLink[] {
  return socialLinkDefinitions.flatMap((definition) => {
    const href = organization[definition.key];
    return href ? [{ ...definition, href }] : [];
  });
}

export function organizationHasSocialLinks(organization: OrganizationSocialProfile) {
  return getOrganizationSocialLinks(organization).length > 0;
}
