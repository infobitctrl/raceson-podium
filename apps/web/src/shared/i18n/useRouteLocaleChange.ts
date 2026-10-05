"use client";

import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { AppLocale } from "@/shared/i18n/locales";

export function useRouteLocaleChange() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setLocale } = useI18n();

  return useCallback((nextLocale: AppLocale) => {
    setLocale(nextLocale, { source: "explicit" });

    const routeLocale = location.pathname.match(/^\/(hr|en)(?=\/|$)/)?.[1];
    if (!routeLocale || routeLocale === nextLocale) return;

    navigate({
      pathname: location.pathname.replace(/^\/(hr|en)(?=\/|$)/, `/${nextLocale}`),
      search: location.search,
      hash: location.hash,
    });
  }, [location.hash, location.pathname, location.search, navigate, setLocale]);
}
