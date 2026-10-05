import type { NextConfig } from "next";
import path from "node:path";
import { validateRewardDemoBuildEnvironment } from "./src/features/rewards/model/demo-build-environment";

const localSupabaseProxyTarget = (
  process.env.RACESON_LOCAL_SUPABASE_PROXY_TARGET
    ?? process.env.SITRAIL_LOCAL_SUPABASE_PROXY_TARGET
)?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  devIndicators: false,
  // Keep production validation builds isolated from the development server's
  // compiler cache. The local end-to-end gate intentionally exercises the
  // running app before invoking `next build`.
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  env: {
    NEXT_PUBLIC_API_BASE_URL:
      process.env.NEXT_PUBLIC_RACESON_API_BASE_URL
      ?? process.env.NEXT_PUBLIC_API_BASE_URL
      ?? "/api",
    NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL:
      process.env.NEXT_PUBLIC_RACESON_AUTH_REDIRECT_BASE_URL
      ?? process.env.NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL
      ?? "",
    NEXT_PUBLIC_DEMO_ATHLETE_SLUG:
      process.env.NEXT_PUBLIC_DEMO_ATHLETE_SLUG ?? "",
    NEXT_PUBLIC_DEMO_ORGANIZATION_SLUG:
      process.env.NEXT_PUBLIC_DEMO_ORGANIZATION_SLUG ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ?? process.env.SUPABASE_ANON_KEY
      ?? "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ?? process.env.SUPABASE_PUBLISHABLE_KEY
      ?? process.env.SUPABASE_ANON_KEY
      ?? "",
    NEXT_PUBLIC_SUPABASE_PUBLIC_URL:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_URL
      ?? process.env.NEXT_PUBLIC_SUPABASE_URL
      ?? process.env.SUPABASE_URL
      ?? "",
    NEXT_PUBLIC_SUPABASE_STORAGE_KEY:
      process.env.NEXT_PUBLIC_RACESON_SUPABASE_STORAGE_KEY
      ?? process.env.NEXT_PUBLIC_SUPABASE_STORAGE_KEY
      ?? "raceson-auth",
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL
      ?? process.env.SUPABASE_URL
      ?? "",
  },
  images: {
    disableStaticImages: true,
    qualities: [60, 75],
    remotePatterns: [{
      protocol: "https",
      hostname: "**.supabase.co",
      port: "",
      pathname: "/storage/v1/object/public/**",
    }],
  },
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  turbopack: {},
  webpack(config) {
    // GitHub-hosted runners are ephemeral, so persisting webpack's large build
    // cache spends disk and time without benefiting a later release check.
    if (process.env.CI === "true") config.cache = false;
    config.module.rules.push({
      test: /\.(?:avif|gif|jpe?g|png|svg|webp)$/i,
      exclude: [
        path.resolve(process.cwd(), "app/icon.png"),
        path.resolve(process.cwd(), "app/apple-icon.png"),
      ],
      type: "asset/resource",
      generator: {
        filename: "static/media/[name].[contenthash][ext]",
      },
    });
    return config;
  },
  async redirects() {
    return [
      {
        source: "/races/:eventId/results/:registrationId",
        destination: "/events/:eventId/results/:registrationId",
        permanent: true,
      },
      {
        source: "/races/:eventId/tracks/:trackId",
        destination: "/events/:eventId/tracks/:trackId",
        permanent: true,
      },
      {
        source: "/leagues/:leagueId/races/:eventId/tracks/:trackId",
        destination: "/leagues/:leagueId/events/:eventId/tracks/:trackId",
        permanent: true,
      },
      {
        source: "/leagues/:leagueId/races/:eventId",
        destination: "/leagues/:leagueId/events/:eventId",
        permanent: true,
      },
      {
        source: "/stats",
        destination: "/stats/athletes",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    if (!localSupabaseProxyTarget) return [];

    return [{
      source: "/local-supabase/:path*",
      destination: `${localSupabaseProxyTarget}/:path*`,
    }];
  },
  transpilePackages: ["@raceson/db", "@raceson/domain"],
};

validateRewardDemoBuildEnvironment(process.env, nextConfig.env ?? {});

export default nextConfig;
