"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";

type ThemeToggleLabels = {
  change: string;
  switchDark: string;
  switchLight: string;
};

export default function ThemeToggle({
  className,
  labels,
}: {
  className?: string;
  labels?: ThemeToggleLabels;
}) {
  const { t } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const dark = resolvedTheme === "dark";

  useEffect(() => {
    setMounted(true);
  }, []);

  const nextTheme = dark ? "light" : "dark";
  const accessibleLabel = mounted
    ? dark ? labels?.switchLight ?? t("theme.switchLight") : labels?.switchDark ?? t("theme.switchDark")
    : labels?.change ?? t("theme.change");

  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme)}
      className={cn(
        "relative flex h-9 w-9 items-center justify-center rounded-xl border border-border/80 bg-card text-muted-foreground shadow-soft transition-[background-color,border-color,color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-secondary hover:text-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <AnimatePresence mode="wait" initial={false}>
        {mounted && dark ? (
          <motion.div
            key="sun"
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Sun className="h-4 w-4" />
          </motion.div>
        ) : (
          <motion.div
            key="moon"
            initial={{ rotate: 90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: -90, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Moon className="h-4 w-4" />
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}
