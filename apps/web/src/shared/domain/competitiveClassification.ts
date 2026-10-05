export type PublicSexCode = "M" | "F" | "U" | string | null | undefined;

export type ClassificationLabels = {
  label: string;
  shortLabel: string;
};

const classificationAgeQualifierPattern = "(u\\s*\\d{1,3}|\\d{1,3}(?:\\.\\d+)?(?:\\s*[-–—]\\s*\\d{1,3}(?:\\.\\d+)?)?|\\d{1,3}(?:\\.\\d+)?\\s*\\+)";
const leadingSexAgePattern = new RegExp(`^(female|woman|women|girl|girls|male|man|men|boy|boys)\\s+${classificationAgeQualifierPattern}$`, "i");
const trailingSexAgePattern = new RegExp(`^${classificationAgeQualifierPattern}\\s+(female|woman|women|girl|girls|male|man|men|boy|boys)$`, "i");

export function formatSexLabel(value: PublicSexCode) {
  const normalized = (value ?? "").trim().toUpperCase();
  if (normalized === "F") return "Female";
  if (normalized === "M") return "Male";
  return "Open";
}

export function formatSexCode(value: PublicSexCode) {
  const normalized = (value ?? "").trim().toUpperCase();
  return normalized === "F" || normalized === "M" ? normalized : "";
}

export function formatSexClassificationLabel(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  const normalizedSpacing = normalized
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
  const compact = normalized
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  const leadingSexAge = normalizedSpacing.match(leadingSexAgePattern);
  const trailingSexAge = normalizedSpacing.match(trailingSexAgePattern);
  const sexAgeMatch = leadingSexAge
    ? { sex: leadingSexAge[1], age: leadingSexAge[2] }
    : trailingSexAge
      ? { sex: trailingSexAge[2], age: trailingSexAge[1] }
      : null;
  if (sexAgeMatch) {
    const sex = /^(?:female|woman|women|girl|girls)$/i.test(sexAgeMatch.sex) ? "Female" : "Male";
    const age = sexAgeMatch.age.replace(/\s+/g, "").replace(/[–—]/g, "-").toUpperCase();
    return `${sex} ${age}`;
  }
  if (/^(?:girl|girls)(?: u\s*16)?$/.test(compact)
    || /^(?:female|woman|women) u\s*16$/.test(compact)
    || /^u\s*16 (?:girl|girls|female|woman|women)$/.test(compact)) {
    return "Female U16";
  }
  if (/^(?:boy|boys)(?: u\s*16)?$/.test(compact)
    || /^(?:male|man|men) u\s*16$/.test(compact)
    || /^u\s*16 (?:boy|boys|male|man|men)$/.test(compact)) {
    return "Male U16";
  }
  if (/^(?:woman|women)$/i.test(normalized)) return "Female";
  if (/^(?:man|men)$/i.test(normalized)) return "Male";
  if (/^(?:woman|women)\s+open$/i.test(normalized)) return "Female Open";
  if (/^(?:man|men)\s+open$/i.test(normalized)) return "Male Open";
  return normalized;
}

export function formatCompactClassificationLabel(value: string | null | undefined) {
  const label = formatSexClassificationLabel(value);
  if (/^overall$/i.test(label)) return "OVR";
  const sexAgeCategory = label.match(/^(female|male)\s+(u\s*\d{1,3}|\d{1,3}(?:\.\d+)?(?:\s*[-–—]\s*\d{1,3}(?:\.\d+)?)?|\d{1,3}(?:\.\d+)?\s*\+)$/i);
  if (sexAgeCategory) {
    const sex = sexAgeCategory[1].toLowerCase() === "female" ? "F" : "M";
    const age = sexAgeCategory[2].replace(/\s+/g, "").replace(/[–—]/g, "-").toUpperCase();
    return `${sex}${age}`;
  }
  if (/^female(?: open)?$/i.test(label)) return "F";
  if (/^male(?: open)?$/i.test(label)) return "M";
  const senior = label.match(/^senior\s+(\d+)\+$/i);
  if (senior) return `S${senior[1]}+`;
  const under = label.match(/^u\s*(\d{1,3})$/i);
  if (under) return `U${under[1]}`;

  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return label.slice(0, 6);
  return words.map((word) => word[0]).join("").slice(0, 6).toUpperCase();
}

export function getClassificationLabels(
  value: string | null | undefined,
): ClassificationLabels {
  const label = formatSexClassificationLabel(value);
  return {
    label,
    shortLabel: formatCompactClassificationLabel(label),
  };
}

export function formatUniversalAgeCategoryLabel(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  if (!normalized) return "Open";
  const universal = normalized
    .replace(/^(?:female|male|women|men|girls?|boys?)\s+/i, "")
    .replace(/\s+(?:female|male|women|men|girls?|boys?)$/i, "")
    .replace(/^[MW]\s*(?=\d)/i, "")
    .trim();
  return universal || "Open";
}
