const nearbyCountryOptions = [
  { label: "Croatia", value: "HR" },
  { label: "Slovenia", value: "SI" },
  { label: "Hungary", value: "HU" },
  { label: "Bosnia and Herzegovina", value: "BA" },
  { label: "Serbia", value: "RS" },
  { label: "Montenegro", value: "ME" },
  { label: "Italy", value: "IT" },
  { label: "Austria", value: "AT" },
] as const;

const nearbyCountryCodes = nearbyCountryOptions.map<string>((country) => country.value);

const allCountryCodes = `
  AD AE AF AG AI AL AM AO AQ AR AS AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
  CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO
  FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE
  JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO
  MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW
  PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM
  TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW
`.trim().split(/\s+/);

const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });

export const countryOptions = [
  ...nearbyCountryOptions,
  ...allCountryCodes
    .filter((value) => !nearbyCountryCodes.includes(value))
    .map((value) => ({
      value,
      label: countryDisplayNames.of(value) ?? "Unknown country",
    }))
    .sort((left, right) => left.label.localeCompare(right.label)),
];

const countryNameByCode = new Map(countryOptions.map((country) => [country.value, country.label]));
const countryCodeByName = new Map(
  countryOptions.map((country) => [country.label.trim().toLocaleLowerCase("en"), country.value]),
);

const countryNameAliases = new Map([
  ["bosnia", "BA"],
  ["bosnia & herzegovina", "BA"],
  ["uk", "GB"],
  ["united states of america", "US"],
  ["usa", "US"],
]);

export function countryCodeForInput(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;

  const possibleCode = normalized.toUpperCase();
  if (/^[A-Z]{2}$/.test(possibleCode) && countryNameByCode.has(possibleCode)) {
    return possibleCode;
  }

  const nameKey = normalized.toLocaleLowerCase("en");
  return countryCodeByName.get(nameKey) ?? countryNameAliases.get(nameKey) ?? null;
}

export function countryName(value: string | null | undefined, emptyFallback = "") {
  const normalized = value?.trim();
  if (!normalized) return emptyFallback;

  const code = countryCodeForInput(normalized);
  if (code) return countryNameByCode.get(code) ?? "Unknown country";

  // Already-expanded names from older imports are safe to show as entered. A
  // two-letter value is never allowed to leak back into the interface.
  return /^[A-Za-z]{2}$/.test(normalized) ? "Unknown country" : normalized;
}
