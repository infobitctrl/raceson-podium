"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";

export const PORTAL_THEME_STORAGE_KEY = "raceson-theme-v1";

export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableColorScheme
      enableSystem={false}
      storageKey={PORTAL_THEME_STORAGE_KEY}
      themes={["light", "dark"]}
    >
      {children}
    </ThemeProvider>
  );
}
