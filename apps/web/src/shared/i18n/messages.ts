import type { AppLocale } from "./locales";
import { englishMessages, type TranslationKey, type TranslationValues } from "./englishMessages";
import { croatianMessages } from "./croatianMessages";
import { interpolateMessage } from "./translateEnglish";

export { englishMessages, type TranslationKey, type TranslationValues } from "./englishMessages";
export { croatianMessages } from "./croatianMessages";

export const messagesByLocale: Record<AppLocale, Record<TranslationKey, string>> = {
  en: englishMessages,
  hr: croatianMessages,
};

export function translate(
  locale: AppLocale,
  key: TranslationKey,
  values: TranslationValues = {},
) {
  const template = messagesByLocale[locale]?.[key] ?? englishMessages[key] ?? String(key);
  return interpolateMessage(template, values);
}
