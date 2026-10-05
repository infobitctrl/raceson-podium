import type { NextConfig } from "next";
import path from "node:path";
import { validateRewardDemoBuildEnvironment } from "../../../apps/web/src/features/rewards/model/demo-build-environment";
import { rewardPrivyConfiguration } from "../../../apps/web/src/features/rewards/model/privyConfiguration";

// This app has its own env-file root. Never import the portal's Next config,
// .env files, deployment metadata, redirects, proxy or analytics settings.
const exposed = {
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_RACESON_API_BASE_URL ?? "",
  NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL: process.env.NEXT_PUBLIC_RACESON_AUTH_REDIRECT_BASE_URL ?? "",
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  NEXT_PUBLIC_SUPABASE_PUBLIC_URL: process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_URL ?? "",
  NEXT_PUBLIC_SUPABASE_STORAGE_KEY: process.env.NEXT_PUBLIC_RACESON_SUPABASE_STORAGE_KEY ?? "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};
const demo = validateRewardDemoBuildEnvironment(process.env, exposed);
if (!demo) {
  throw new Error("reward_demo_configuration_required");
}
// Both are public identifiers, but intentional provider activation must match
// the independently validated demo target. Never inherit generic PRIVY_* keys.
if ((process.env.RACESON_REWARD_PRIVY_APP_ID ?? "") !== (process.env.NEXT_PUBLIC_RACESON_REWARD_PRIVY_APP_ID ?? ""))
  throw new Error("reward_privy_configuration_required");
rewardPrivyConfiguration(process.env.NEXT_PUBLIC_RACESON_REWARD_PRIVY_APP_ID, demo, demo.origin);

if ((process.env.RACESON_REWARD_HOSTED_COPY_MODE ?? "") !== (process.env.NEXT_PUBLIC_RACESON_REWARD_HOSTED_COPY_MODE ?? "")
 || (process.env.RACESON_REWARD_HOSTED_COPY_MODE && (process.env.RACESON_REWARD_HOSTED_COPY_MODE !== "sponsor-drafts-v1" || demo.mode !== "testnet" || demo.supabaseUrl !== "https://niklhlmljiikwbkrmapw.supabase.co")))
 throw new Error("hosted_copy_configuration_required");
if((process.env.RACESON_REWARD_HOSTED_OPERATIONS??'')!==(process.env.NEXT_PUBLIC_RACESON_REWARD_HOSTED_OPERATIONS??'')
 ||process.env.RACESON_REWARD_HOSTED_OPERATIONS&&(process.env.RACESON_REWARD_HOSTED_OPERATIONS!=='testnet-v1'
  ||process.env.RACESON_REWARD_HOSTED_COPY_MODE!=='sponsor-drafts-v1'||demo.mode!=='testnet'))throw new Error('hosted_copy_configuration_required');

const config: NextConfig = {
  devIndicators: false,
  distDir: process.env.NODE_ENV === "production" ? ".next-build"
    : process.env.RACESON_REWARD_PORTAL_MODE === "local-testnet" ? ".next-testnet" : ".next",
  env: exposed,
  outputFileTracingRoot: path.resolve(process.cwd(), "../../.."),
  transpilePackages: ["@raceson/api", "@raceson/db", "@raceson/domain"],
  images: {
    disableStaticImages: true,
    // The validated isolated project is the only remote image authority. Local
    // modes do not enable server-side fetches into private/loopback addresses.
    remotePatterns: demo.mode === "testnet" ? [{
      protocol: "https", hostname: new URL(demo.supabaseUrl).hostname, port: "",
      pathname: "/storage/v1/object/public/**", search: "",
    }] : [],
    maximumRedirects: 0,
  },
  webpack(config) {
    if (process.env.CI === "true") config.cache = false;
    config.module.rules.push({
      test: /\.(?:avif|gif|jpe?g|png|svg|webp)$/i,
      type: "asset/resource",
      generator: { filename: "static/media/[name].[contenthash][ext]" },
    });
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Referrer-Policy", value: "same-origin" },
    ] }];
  },
};
export default config;
