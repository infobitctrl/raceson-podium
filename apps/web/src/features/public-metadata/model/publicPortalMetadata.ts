import { canonicalEventSlug, storedEventSlug } from "@/features/events/model/eventUrl";
import { STATIC_PAGE_DEFINITIONS, localizedStaticDefinition } from "./publicPageDefinitions";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { resolveLeagueImageUrl } from "@/features/leagues/model/leagueMedia";
import {
  localizedPublicPath,
  publicLanguageAlternates,
} from "@/features/public-metadata/model/publicLocales";
import { publicEnv } from "@/lib/public-env";
import { brand } from "@/shared/brand/brand";
import type { AppLocale } from "@/shared/i18n/locales";
import { resolveRecoveredPublicMediaUrl } from "@/shared/media/recoveredPublicMedia";
import {
  DEFAULT_SOCIAL_IMAGE,
  HOME_SOCIAL_TITLE,
  HOME_SOCIAL_TITLE_HR,
} from "./publicSocialMetadata";

const PRIVATE_ROUTE_PREFIXES = new Set([
  "notifications",
  "account",
  "athlete",
  "auth",
  "organizer",
  "registration",
]);

export const INDEXABLE_STATIC_PATHS = Object.freeze(Object.keys(STATIC_PAGE_DEFINITIONS));

type PublicEntityKind = "event" | "track" | "league" | "club" | "athlete";

type JsonLdNode = Record<string, unknown>;

export type PublicEventHeroShellData = {
  name: string;
  description?: string;
  imageUrl: string | null;
  locationLabel: string;
  startDate: string;
  endDate: string;
  status: string;
};

type PublicMetadataEntity = {
  title: string;
  description: string;
  canonicalPath: string;
  imageUrl?: string | null;
  kind: PublicEntityKind;
  structuredData: JsonLdNode;
  dateCreated?: string | null;
  dateModified?: string | null;
  eventHero?: PublicEventHeroShellData;
};

type ResolvedSeoRoute =
  | { type: "static"; path: string }
  | { type: "entity"; section: PublicEntityKind; slug: string }
  | { type: "noindex"; title?: string; titles?: Readonly<Record<AppLocale, string>> }
  | { type: "unknown" };

const NOINDEX_ROUTE_TITLES: Readonly<Record<string, Readonly<Record<AppLocale, string>>>> = {
  notifications: { en: "Notifications", hr: "Obavijesti" },
  auth: {
    en: "Sign in or create an account",
    hr: "Prijava ili izrada računa",
  },
  "auth/reset": {
    en: "Reset password",
    hr: "Promjena lozinke",
  },
  legal: {
    en: "Privacy and legal",
    hr: "Privatnost i pravne informacije",
  },
};

function publicMetadataClient() {
  if (!publicEnv.supabaseUrl || !publicEnv.supabasePublishableKey) return null;
  return createClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function canonicalUrl(path: string) {
  return new URL(path || "/", brand.origin).toString();
}

function publicLeagueDescription(value: string | null | undefined) {
  return (value ?? "")
    .split(/\r?\n/)
    .filter((line) => !/^League Image:\s*/i.test(line.trim()))
    .join("\n")
    .trim();
}

function conciseDescription(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, " ").trim() || fallback;
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 177).trimEnd()}…`;
}

function publicSeoImageUrl(value: string | null | undefined) {
  const imageUrl = resolveRecoveredPublicMediaUrl(value)?.trim();
  if (!imageUrl) return null;
  if (imageUrl.startsWith("/") && !imageUrl.startsWith("//")) return imageUrl;

  try {
    const parsed = new URL(imageUrl);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? imageUrl : null;
  } catch {
    return null;
  }
}

const noIndexRobots: Metadata["robots"] = {
  index: false,
  follow: false,
  nocache: true,
  noarchive: true,
};

function noIndexMetadata(title = "Private RacesOn page"): Metadata {
  return { title, robots: noIndexRobots };
}

function keepOutOfLaunchIndex(metadata: Metadata): Metadata {
  return { ...metadata, robots: noIndexRobots };
}

function pageSocialMetadata(path: string, title: string, description: string): Metadata {
  const canonicalPath = path ? `/${path}` : "/";
  const socialTitle = path ? title : HOME_SOCIAL_TITLE;
  return {
    title: path ? title : { absolute: title },
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      type: "website",
      siteName: brand.name,
      title: socialTitle,
      description,
      url: canonicalPath,
      images: [DEFAULT_SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [DEFAULT_SOCIAL_IMAGE.url],
    },
  };
}

function openGraphLocale(locale: AppLocale) {
  return locale === "hr" ? "hr_HR" : "en_HR";
}

function localizedPageSocialMetadata(
  locale: AppLocale,
  path: string,
  title: string,
  description: string,
): Metadata {
  const canonicalPath = localizedPublicPath(locale, path ? `/${path}` : "/");
  const alternateLocale: AppLocale = locale === "hr" ? "en" : "hr";
  const socialTitle = path
    ? title
    : locale === "hr" ? HOME_SOCIAL_TITLE_HR : HOME_SOCIAL_TITLE;

  return {
    title: path ? title : { absolute: title },
    description,
    alternates: {
      canonical: canonicalPath,
      languages: publicLanguageAlternates(path ? `/${path}` : "/"),
    },
    openGraph: {
      type: "website",
      siteName: brand.name,
      title: socialTitle,
      description,
      url: canonicalPath,
      locale: openGraphLocale(locale),
      alternateLocale: [openGraphLocale(alternateLocale)],
      images: [DEFAULT_SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [DEFAULT_SOCIAL_IMAGE.url],
    },
  };
}

export function buildPublicEntityMetadata(entity: PublicMetadataEntity): Metadata {
  const image = publicSeoImageUrl(entity.imageUrl);
  const socialImage = image ? { url: image, alt: entity.title } : DEFAULT_SOCIAL_IMAGE;
  const description = conciseDescription(entity.description, `${entity.title} on ${brand.name}.`);

  return {
    title: entity.title,
    description,
    alternates: {
      canonical: entity.canonicalPath,
    },
    openGraph: {
      type: entity.kind === "athlete" ? "profile" : "website",
      siteName: brand.name,
      title: entity.title,
      description,
      url: entity.canonicalPath,
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      title: entity.title,
      description,
      images: [image || DEFAULT_SOCIAL_IMAGE.url],
    },
    other: {
      "raceson:entity": entity.kind,
    },
  };
}

function buildLocalizedPublicEntityMetadata(
  entity: PublicMetadataEntity,
  locale: AppLocale,
): Metadata {
  const image = publicSeoImageUrl(entity.imageUrl);
  const socialImage = image ? { url: image, alt: entity.title } : DEFAULT_SOCIAL_IMAGE;
  const description = conciseDescription(entity.description, `${entity.title} on ${brand.name}.`);
  const canonicalPath = localizedPublicPath(locale, entity.canonicalPath);
  const alternateLocale: AppLocale = locale === "hr" ? "en" : "hr";

  return {
    title: entity.title,
    description,
    alternates: {
      canonical: canonicalPath,
      languages: publicLanguageAlternates(entity.canonicalPath),
    },
    openGraph: {
      type: entity.kind === "athlete" ? "profile" : "website",
      siteName: brand.name,
      title: entity.title,
      description,
      url: canonicalPath,
      locale: openGraphLocale(locale),
      alternateLocale: [openGraphLocale(alternateLocale)],
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      title: entity.title,
      description,
      images: [image || DEFAULT_SOCIAL_IMAGE.url],
    },
    other: {
      "raceson:entity": entity.kind,
      "raceson:language": locale,
    },
  };
}

function resolveSeoRoute(slugParts: string[]): ResolvedSeoRoute {
  const parts = slugParts.filter(Boolean);
  const path = parts.join("/");
  const [section, entitySlug] = parts;

  if (path in STATIC_PAGE_DEFINITIONS) return { type: "static", path };
  if (!section) return { type: "static", path: "" };
  if (path in NOINDEX_ROUTE_TITLES) return { type: "noindex", titles: NOINDEX_ROUTE_TITLES[path] };
  if (PRIVATE_ROUTE_PREFIXES.has(section)) return { type: "noindex" };

  if (section === "live" && entitySlug) {
    return parts.length === 3
      ? { type: "noindex", titles: { en: "Live on Route", hr: "Uživo na ruti" } }
      : { type: "unknown" };
  }

  if (section === "races") {
    if (!entitySlug) return { type: "static", path: "events" };
    if (parts[2] === "results" || parts[2] === "tracks") return { type: "noindex" };
    return { type: "entity", section: "event", slug: entitySlug };
  }

  if (section === "events") {
    if (!entitySlug) return { type: "static", path: "events" };
    if (parts[2] === "results") return { type: "noindex" };
    if (parts[2] === "tracks" && parts[3]) {
      return { type: "entity", section: "track", slug: parts[3] };
    }
    if (parts.length > 2) return { type: "unknown" };
    return { type: "entity", section: "event", slug: entitySlug };
  }

  if (section === "leagues" && entitySlug) {
    if ((parts[2] === "events" || parts[2] === "races") && parts[3]) {
      if (parts[4] === "tracks" && parts[5]) {
        return { type: "entity", section: "track", slug: parts[5] };
      }
      return { type: "entity", section: "event", slug: parts[3] };
    }
    if (parts.length > 2) return { type: "unknown" };
    return { type: "entity", section: "league", slug: entitySlug };
  }

  if (section === "tracks" && entitySlug && parts.length === 2) {
    return { type: "entity", section: "track", slug: entitySlug };
  }
  if (section === "clubs" && entitySlug && parts.length === 2) {
    if (entitySlug === "create") return { type: "noindex" };
    return { type: "entity", section: "club", slug: entitySlug };
  }
  if (section === "clubs" && parts[2] === "edit") return { type: "noindex" };
  if (section === "athletes" && entitySlug && parts.length === 2) {
    return { type: "entity", section: "athlete", slug: entitySlug };
  }

  return { type: "unknown" };
}

async function loadEventEntity(slug: string): Promise<PublicMetadataEntity | null> {
  const supabase = publicMetadataClient();
  if (!supabase) return null;

  const { data: event, error } = await supabase
    .from("event_editions")
    .select("id,event_series_id,slug,name,about_text,cover_image_url,start_date,end_date,timezone,location_name,registration_open_at,registration_close_at,status,updated_at")
    .eq("slug", storedEventSlug(slug))
    .eq("public_visibility", "public")
    .not("published_at", "is", null)
    .neq("status", "draft")
    .maybeSingle();
  if (error || !event) return null;

  const [{ data: series }, { data: categories }, { data: locations }] = await Promise.all([
    supabase
      .from("event_series")
      .select("organization_id,description,location_name,country_code")
      .eq("id", event.event_series_id)
      .maybeSingle(),
    supabase
      .from("event_categories")
      .select("name,start_at,registration_fee_cents,currency,status")
      .eq("event_edition_id", event.id)
      .neq("status", "draft")
      .order("start_at", { ascending: true }),
    supabase
      .from("event_locations")
      .select("location_type,label,place_label,latitude,longitude,display_order")
      .eq("event_edition_id", event.id)
      .order("display_order", { ascending: true }),
  ]);

  const { data: organizer } = series?.organization_id
    ? await supabase
      .from("organizations")
      .select("name")
      .eq("id", series.organization_id)
      .maybeSingle()
    : { data: null };

  const canonicalPath = `/events/${canonicalEventSlug(event.slug)}`;
  const description = conciseDescription(
    event.about_text || series?.description || "",
    `${event.name}: race information, registration, route details, and official results on ${brand.name}.`,
  );
  const eventLocation = locations?.find((item) => item.location_type === "start_zone")
    ?? locations?.[0]
    ?? null;
  const placeName = eventLocation?.place_label
    || event.location_name
    || series?.location_name
    || "Croatia";
  const startDate = categories?.find((category) => category.start_at)?.start_at || event.start_date;
  const categoryOffers = event.status === "registration_open" ? (categories ?? [])
    .filter((category) => category.registration_fee_cents != null && category.currency)
    .map((category) => ({
      "@type": "Offer",
      name: category.name,
      url: `${canonicalUrl(canonicalPath)}#registration`,
      price: (Number(category.registration_fee_cents) / 100).toFixed(2),
      priceCurrency: category.currency,
      availability: "https://schema.org/InStock",
      validFrom: event.registration_open_at || undefined,
      validThrough: event.registration_close_at || undefined,
    })) : [];
  const imageUrl = publicSeoImageUrl(event.cover_image_url);

  return {
    kind: "event",
    title: event.name,
    description,
    canonicalPath,
    imageUrl,
    eventHero: {
      name: event.name,
      description,
      imageUrl,
      locationLabel: placeName,
      startDate,
      endDate: event.end_date || event.start_date,
      status: event.status,
    },
    structuredData: {
      "@type": "SportsEvent",
      "@id": `${canonicalUrl(canonicalPath)}#event`,
      name: event.name,
      description,
      url: canonicalUrl(canonicalPath),
      image: imageUrl ? [imageUrl] : undefined,
      startDate,
      endDate: event.end_date || event.start_date,
      eventStatus: ["cancelled", "canceled"].includes(event.status)
        ? "https://schema.org/EventCancelled"
        : "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: {
        "@type": "Place",
        name: eventLocation?.label || placeName,
        address: {
          "@type": "PostalAddress",
          addressLocality: placeName,
          addressCountry: series?.country_code || "HR",
        },
        geo: eventLocation?.latitude != null && eventLocation.longitude != null
          ? {
              "@type": "GeoCoordinates",
              latitude: Number(eventLocation.latitude),
              longitude: Number(eventLocation.longitude),
            }
          : undefined,
      },
      organizer: organizer?.name
        ? { "@type": "Organization", name: organizer.name }
        : { "@id": `${brand.origin}/#organization` },
      offers: categoryOffers.length ? categoryOffers : undefined,
      // Categories share this edition page and are represented by its named offers.
      // Do not emit incomplete duplicate Event items for the same canonical URL.
    },
  };
}

async function loadTrackEntity(slug: string): Promise<PublicMetadataEntity | null> {
  const supabase = publicMetadataClient();
  if (!supabase) return null;

  const { data: track, error } = await supabase
    .from("track_templates")
    .select("id,slug,name,public_overview,gallery_preview_image_url,location_label,terrain_type,updated_at")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !track) return null;

  const { data: version } = await supabase
    .from("track_versions")
    .select("distance_km,elevation_gain_m,start_lat,start_lng,published_at")
    .eq("track_template_id", track.id)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!version) return null;

  const canonicalPath = `/tracks/${track.slug}`;
  const description = conciseDescription(
    track.public_overview || "",
    `${track.name}: race route map, distance, elevation, terrain, checkpoints, and GPX details on ${brand.name}.`,
  );

  return {
    kind: "track",
    title: track.name,
    description,
    canonicalPath,
    imageUrl: typeof track.gallery_preview_image_url === "string"
      ? track.gallery_preview_image_url.trim() || null
      : null,
    structuredData: {
      "@type": "Place",
      "@id": `${canonicalUrl(canonicalPath)}#route`,
      name: track.name,
      description,
      url: canonicalUrl(canonicalPath),
      address: track.location_label
        ? { "@type": "PostalAddress", addressLocality: track.location_label }
        : undefined,
      geo: version.start_lat != null && version.start_lng != null
        ? {
            "@type": "GeoCoordinates",
            latitude: Number(version.start_lat),
            longitude: Number(version.start_lng),
          }
        : undefined,
      additionalProperty: [
        version.distance_km != null
          ? { "@type": "PropertyValue", name: "Distance", value: Number(version.distance_km), unitCode: "KMT" }
          : null,
        version.elevation_gain_m != null
          ? { "@type": "PropertyValue", name: "Elevation gain", value: Number(version.elevation_gain_m), unitCode: "MTR" }
          : null,
        track.terrain_type
          ? { "@type": "PropertyValue", name: "Terrain", value: track.terrain_type }
          : null,
      ].filter(Boolean),
    },
  };
}

async function loadLeagueEntity(slug: string): Promise<PublicMetadataEntity | null> {
  const supabase = publicMetadataClient();
  if (!supabase) return null;

  const { data: league, error } = await supabase
    .from("leagues")
    .select("id,slug,name,description,status,updated_at")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !league) return null;

  const { data: publishedSeason } = await supabase
    .from("league_seasons")
    .select("id,name,year,published_at")
    .eq("league_id", league.id)
    .not("published_at", "is", null)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!publishedSeason) return null;

  const canonicalPath = `/leagues/${league.slug}`;
  const description = conciseDescription(
    publicLeagueDescription(league.description),
    `${league.name}: race calendar, rounds, official results, athlete rankings, and club standings on ${brand.name}.`,
  );

  return {
    kind: "league",
    title: league.name,
    description,
    canonicalPath,
    imageUrl: resolveLeagueImageUrl(league.description),
    structuredData: {
      "@type": "SportsOrganization",
      "@id": `${canonicalUrl(canonicalPath)}#league`,
      name: league.name,
      description,
      url: canonicalUrl(canonicalPath),
      sport: "Endurance racing",
      alternateName: publishedSeason.name,
    },
  };
}

async function loadClubEntity(slug: string): Promise<PublicMetadataEntity | null> {
  const supabase = publicMetadataClient();
  if (!supabase) return null;

  const { data: club, error } = await supabase
    .from("clubs")
    .select("slug,name,description,city,region,country_code,logo_image_url,cover_image_url,website_url,instagram_url,facebook_url,privacy_level,status,merged_into_club_id,main_sport")
    .eq("slug", slug)
    .eq("status", "active")
    .is("merged_into_club_id", null)
    .maybeSingle();
  if (error || !club || club.privacy_level === "invite_only") return null;

  const canonicalPath = `/clubs/${club.slug}`;
  const description = conciseDescription(
    club.description || "",
    `${club.name}: athletes, race history, league participation, and club information on ${brand.name}.`,
  );
  const sameAs = [club.website_url, club.instagram_url, club.facebook_url].filter(Boolean);
  const logoImageUrl = publicSeoImageUrl(club.logo_image_url);
  const imageUrl = publicSeoImageUrl(club.cover_image_url) || logoImageUrl;

  return {
    kind: "club",
    title: club.name,
    description,
    canonicalPath,
    imageUrl,
    structuredData: {
      "@type": "SportsOrganization",
      "@id": `${canonicalUrl(canonicalPath)}#club`,
      name: club.name,
      description,
      url: canonicalUrl(canonicalPath),
      logo: logoImageUrl || undefined,
      image: imageUrl || undefined,
      sport: club.main_sport || "Endurance sport",
      address: club.city || club.region || club.country_code
        ? {
            "@type": "PostalAddress",
            addressLocality: club.city || undefined,
            addressRegion: club.region || undefined,
            addressCountry: club.country_code || undefined,
          }
        : undefined,
      sameAs: sameAs.length ? sameAs : undefined,
    },
  };
}

async function loadAthleteEntity(slug: string): Promise<PublicMetadataEntity | null> {
  const supabase = publicMetadataClient();
  if (!supabase) return null;

  const { data: athlete, error } = await supabase
    .from("public_athlete_profiles")
    .select("slug,display_name,city,country_code,status,created_at,updated_at")
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  if (error || !athlete) return null;

  const canonicalPath = `/athletes/${athlete.slug}`;
  const description = `${athlete.display_name}: official race history, results, performance, clubs, and league participation on ${brand.name}.`;

  return {
    kind: "athlete",
    title: athlete.display_name,
    description,
    canonicalPath,
    dateCreated: athlete.created_at,
    dateModified: athlete.updated_at,
    structuredData: {
      "@type": "Person",
      "@id": `${canonicalUrl(canonicalPath)}#athlete`,
      name: athlete.display_name,
      description,
      identifier: athlete.slug,
      url: canonicalUrl(canonicalPath),
      homeLocation: athlete.city || athlete.country_code
        ? {
            "@type": "Place",
            name: [athlete.city, athlete.country_code].filter(Boolean).join(", "),
          }
        : undefined,
    },
  };
}

const loadPublicEntityCached = unstable_cache(
  async function loadPublicEntityCached(kind: PublicEntityKind, slug: string) {
    if (kind === "event") return loadEventEntity(slug);
    if (kind === "track") return loadTrackEntity(slug);
    if (kind === "league") return loadLeagueEntity(slug);
    if (kind === "club") return loadClubEntity(slug);
    return loadAthleteEntity(slug);
  },
  ["public-portal-entity"],
  { revalidate: 300, tags: ["public-portal-entity"] },
);

async function loadPublicEntity(kind: PublicEntityKind, slug: string) {
  try {
    return await loadPublicEntityCached(kind, slug);
  } catch (error) {
    console.warn(`Unable to build public SEO data for ${kind}/${slug}`, error);
    return null;
  }
}

export async function getPublicEventHeroShellData(slug: string) {
  const entity = await loadPublicEntity("event", slug);
  return entity?.kind === "event" ? entity.eventHero ?? null : null;
}

export async function getPublicPortalMetadata(slugParts: string[]): Promise<Metadata> {
  const route = resolveSeoRoute(slugParts);
  if (route.type === "static") {
    const definition = STATIC_PAGE_DEFINITIONS[route.path];
    const metadata = pageSocialMetadata(route.path, definition.title, definition.description);
    return route.path === "" || route.path === "events"
      ? metadata
      : keepOutOfLaunchIndex(metadata);
  }
  if (route.type === "noindex") return noIndexMetadata(route.titles?.en ?? route.title);
  if (route.type === "unknown") return noIndexMetadata("Page not found");

  const entity = await loadPublicEntity(route.section, route.slug);
  if (!entity) return noIndexMetadata("Page not found");
  const metadata = buildPublicEntityMetadata(entity);
  return route.section === "event" && isLaunchReadyEventSitemapSlug(route.slug)
    ? metadata
    : keepOutOfLaunchIndex(metadata);
}

export async function getLocalizedPublicPortalMetadata(
  locale: AppLocale,
  slugParts: string[],
): Promise<Metadata> {
  const route = resolveSeoRoute(slugParts);
  if (route.type === "static") {
    const definition = localizedStaticDefinition(route.path, locale);
    const metadata = localizedPageSocialMetadata(locale, route.path, definition.title, definition.description);
    return route.path === "" || route.path === "events"
      ? metadata
      : keepOutOfLaunchIndex(metadata);
  }
  if (route.type === "noindex") {
    return noIndexMetadata(route.titles?.[locale] ?? route.title);
  }
  if (route.type === "unknown") return noIndexMetadata("Page not found");

  const entity = await loadPublicEntity(route.section, route.slug);
  if (!entity) return noIndexMetadata("Page not found");
  const metadata = buildLocalizedPublicEntityMetadata(entity, locale);
  return route.section === "event" && isLaunchReadyEventSitemapSlug(route.slug)
    ? metadata
    : keepOutOfLaunchIndex(metadata);
}

function breadcrumbNode(path: string, title: string, sectionTitle?: string) {
  const items: JsonLdNode[] = [
    { "@type": "ListItem", position: 1, name: "RacesOn", item: brand.origin },
  ];
  const pathParts = path.split("/").filter(Boolean);
  if (sectionTitle) {
    if (pathParts.length) {
      items.push({
        "@type": "ListItem",
        position: 2,
        name: sectionTitle,
        item: canonicalUrl(`/${pathParts[0]}`),
      });
    }
    if (pathParts.length > 1) {
      items.push({
        "@type": "ListItem",
        position: items.length + 1,
        name: title,
        item: canonicalUrl(`/${path}`),
      });
    }
  } else if (pathParts.length) {
    items.push({
      "@type": "ListItem",
      position: 2,
      name: title,
      item: canonicalUrl(`/${path}`),
    });
  }
  return {
    "@type": "BreadcrumbList",
    "@id": `${canonicalUrl(`/${path}`)}#breadcrumbs`,
    itemListElement: items,
  };
}

export async function getPublicPortalStructuredData(slugParts: string[]): Promise<JsonLdNode | null> {
  const route = resolveSeoRoute(slugParts);
  if (route.type === "noindex" || route.type === "unknown") return null;

  if (route.type === "static") {
    const definition = STATIC_PAGE_DEFINITIONS[route.path];
    const pageUrl = canonicalUrl(route.path ? `/${route.path}` : "/");
    const graph: JsonLdNode[] = [
      {
        "@type": "WebSite",
        "@id": `${brand.origin}/#website`,
        url: `${brand.origin}/`,
        name: brand.name,
        description: brand.description,
        inLanguage: ["en", "hr"],
        publisher: { "@id": `${brand.origin}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${brand.origin}/#organization`,
        name: brand.name,
        url: `${brand.origin}/`,
        logo: canonicalUrl("/raceson-mark.png"),
        description: brand.description,
        slogan: brand.campaignMotto,
      },
      {
        "@type": "WebPage",
        "@id": `${pageUrl}#webpage`,
        url: pageUrl,
        name: definition.title,
        description: definition.description,
        isPartOf: { "@id": `${brand.origin}/#website` },
        about: route.path ? undefined : { "@id": `${brand.origin}/#organization` },
        breadcrumb: route.path ? { "@id": `${pageUrl}#breadcrumbs` } : undefined,
      },
    ];
    if (route.path) graph.push(breadcrumbNode(route.path, definition.title));
    return { "@context": "https://schema.org", "@graph": graph };
  }

  const entity = await loadPublicEntity(route.section, route.slug);
  if (!entity) return null;
  const pageUrl = canonicalUrl(entity.canonicalPath);
  const sectionTitle = STATIC_PAGE_DEFINITIONS[`${route.section}s`]?.title
    ?? (route.section === "athlete" ? STATIC_PAGE_DEFINITIONS.athletes.title : route.section);

  return {
    "@context": "https://schema.org",
    "@graph": [
      entity.structuredData,
      {
        "@type": entity.kind === "athlete" ? "ProfilePage" : "WebPage",
        "@id": `${pageUrl}#webpage`,
        url: pageUrl,
        name: entity.title,
        description: conciseDescription(entity.description, `${entity.title} on ${brand.name}.`),
        isPartOf: { "@id": `${brand.origin}/#website` },
        mainEntity: { "@id": entity.structuredData["@id"] },
        breadcrumb: { "@id": `${pageUrl}#breadcrumbs` },
        dateCreated: entity.kind === "athlete" ? entity.dateCreated || undefined : undefined,
        dateModified: entity.kind === "athlete" ? entity.dateModified || undefined : undefined,
      },
      breadcrumbNode(entity.canonicalPath.slice(1), entity.title, sectionTitle),
    ],
  };
}

function entitySectionPath(kind: PublicEntityKind) {
  return kind === "athlete" ? "/athletes" : `/${kind}s`;
}

function localizeStructuredDataValue(
  value: unknown,
  locale: AppLocale,
  sectionPath: string,
): unknown {
  const sourcePrefix = canonicalUrl(sectionPath);
  const localizedPrefix = canonicalUrl(localizedPublicPath(locale, sectionPath));

  if (typeof value === "string") {
    const suffix = value.slice(sourcePrefix.length);
    const matchesSectionUrl = value.startsWith(sourcePrefix)
      && (!suffix || suffix.startsWith("/") || suffix.startsWith("#") || suffix.startsWith("?"));
    return matchesSectionUrl ? `${localizedPrefix}${suffix}` : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => localizeStructuredDataValue(item, locale, sectionPath));
  }

  if (!value || typeof value !== "object") return value;

  const localizedNode = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      localizeStructuredDataValue(item, locale, sectionPath),
    ]),
  );
  const schemaType = localizedNode["@type"];
  if (
    schemaType === "WebPage"
    || schemaType === "ProfilePage"
    || schemaType === "SportsEvent"
  ) {
    localizedNode.inLanguage = locale;
  }
  return localizedNode;
}

export async function getLocalizedPublicPortalStructuredData(
  locale: AppLocale,
  slugParts: string[],
): Promise<JsonLdNode | null> {
  const route = resolveSeoRoute(slugParts);
  if (route.type === "noindex" || route.type === "unknown") return null;

  const structuredData = await getPublicPortalStructuredData(slugParts);
  if (!structuredData) return null;

  if (route.type === "static") {
    if (!route.path) return structuredData;
    const sectionPath = `/${route.path.split("/")[0]}`;
    const localizedData = localizeStructuredDataValue(
      structuredData,
      locale,
      sectionPath,
    ) as JsonLdNode;
    const definition = localizedStaticDefinition(route.path, locale);
    const graph = Array.isArray(localizedData["@graph"])
      ? (localizedData["@graph"] as JsonLdNode[]).map((node) => {
          if (node["@type"] === "WebPage") {
            return { ...node, name: definition.title, description: definition.description };
          }
          if (node["@type"] !== "BreadcrumbList" || !Array.isArray(node.itemListElement)) {
            return node;
          }
          return {
            ...node,
            itemListElement: node.itemListElement.map((item, index, items) => (
              index === items.length - 1 && item && typeof item === "object"
                ? { ...(item as JsonLdNode), name: definition.title }
                : item
            )),
          };
        })
      : localizedData["@graph"];
    return { ...localizedData, "@graph": graph };
  }

  return localizeStructuredDataValue(
    structuredData,
    locale,
    entitySectionPath(route.section),
  ) as JsonLdNode;
}

export type PublicSitemapEntry = {
  path: string;
  lastModified?: string | null;
  localized?: boolean;
};

const generatedEventSlugSuffix = /-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const duplicateYearSuffix = /-((?:19|20)\d{2})-\1$/;

export function isLaunchReadyEventSitemapSlug(slug: string) {
  const normalized = slug.trim();
  return normalized.length > 0
    && normalized.length <= 96
    && !generatedEventSlugSuffix.test(normalized)
    && !duplicateYearSuffix.test(normalized);
}

export async function getPublicSitemapEntries(): Promise<PublicSitemapEntry[]> {
  // Launch with only route families that return useful, server-rendered HTML.
  // Other public families remain reachable and self-canonical, but stay out of
  // the submitted sitemap until their native crawl surfaces and data curation
  // are complete.
  const sitemapStaticPaths = ["", "events"] as const;
  const entries: PublicSitemapEntry[] = sitemapStaticPaths.map((path) => ({
    path: path ? `/${path}` : "/",
    localized: path === "events",
  }));
  const supabase = publicMetadataClient();
  if (!supabase) return entries;

  try {
    const eventsResult = await supabase
      .from("event_editions")
      .select("slug,updated_at")
      .eq("public_visibility", "public")
      .not("published_at", "is", null)
      .neq("status", "draft");

    entries.push(
      ...(eventsResult.data ?? [])
        .filter((event) => isLaunchReadyEventSitemapSlug(event.slug))
        .map((event) => ({
          path: `/events/${canonicalEventSlug(event.slug)}`,
          lastModified: event.updated_at,
          localized: true,
        })),
    );
  } catch (error) {
    console.warn("Unable to build the dynamic public sitemap", error);
  }

  return Array.from(new Map(entries.map((entry) => [entry.path, entry])).values());
}

export function getPublicMetadataBase() {
  return new URL(brand.origin);
}

export function isPublicIndexingEnabled() {
  return process.env.RACESON_INDEXING_ENABLED?.trim().toLowerCase() === "true";
}

export function getRootRobotsMetadata(): Metadata["robots"] {
  if (!isPublicIndexingEnabled()) {
    return {
      index: false,
      follow: false,
      nocache: true,
      noarchive: true,
    };
  }

  return {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  };
}
