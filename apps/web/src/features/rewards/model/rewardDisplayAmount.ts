import { formatTestMon } from "./athleteRewards";

export function roundedRewardAmount(value: string, locale: "hr" | "en") {
  const wei = BigInt(value), step = 10n ** 14n;
  const rounded = ((wei + step / 2n) / step) * step;
  return { approximate: wei !== rounded, text: rounded === 0n ? (locale === "hr" ? "< 0,0001" : "< 0.0001") : formatTestMon(rounded.toString(), locale) };
}
