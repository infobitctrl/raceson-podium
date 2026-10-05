import portalTheme from "../../../apps/web/tailwind.config";

// Reuse visual tokens without copying the portal application or its routes.
export default {
  ...portalTheme,
  content: ["./app/**/*.{ts,tsx}", "../../../apps/web/src/**/*.{ts,tsx}"],
};
