import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export function useBrandThemeAsset({
  darkSrc,
  lightSrc,
  onLight,
}: {
  darkSrc: string;
  lightSrc: string;
  onLight: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!onLight) return darkSrc;
  if (!mounted) return null;
  return resolvedTheme === "dark" ? darkSrc : lightSrc;
}
