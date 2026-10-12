import { englishMessages, type TranslationKey, type TranslationValues } from "./englishMessages";

export function interpolateMessage(template: string, values: TranslationValues = {}) {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder
  ));
}

export function translateEnglish(key: TranslationKey, values?: TranslationValues) {
  return interpolateMessage(englishMessages[key] ?? String(key), values);
}
