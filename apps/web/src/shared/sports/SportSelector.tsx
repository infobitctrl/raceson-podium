import {
  DEFAULT_SPORT_CODE,
  SPORT_DEFINITIONS,
  normalizeSportCodes,
  type SportCode,
} from "@raceson/domain/sports";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/shared/i18n/I18nContext";
import { SportBadge } from "./SportBadge";
import { sportMessageKeys } from "./sportMessages";

export function SportSelector({
  selectedSportCodes,
  primarySportCode,
  onChange,
  label,
  description,
}: {
  selectedSportCodes?: readonly SportCode[];
  primarySportCode?: SportCode;
  onChange: (sportCodes: SportCode[], primarySportCode: SportCode) => void;
  label?: string;
  description?: string;
}) {
  const { t } = useI18n();
  const resolvedLabel = label ?? t("sport.group");
  const resolvedDescription = description ?? t("sport.selector.description");
  const selected = normalizeSportCodes(selectedSportCodes);
  const primary = primarySportCode && selected.includes(primarySportCode)
    ? primarySportCode
    : selected[0] ?? DEFAULT_SPORT_CODE;

  function toggleSport(sportCode: SportCode, checked: boolean) {
    if (!checked && selected.length === 1) return;
    const next = checked
      ? normalizeSportCodes([...selected, sportCode])
      : selected.filter((code) => code !== sportCode);
    onChange(next, next.includes(primary) ? primary : next[0]);
  }

  return (
    <fieldset className="space-y-3">
      <div>
        <legend className="text-sm font-semibold text-foreground">{resolvedLabel}</legend>
        <p className="mt-1 text-xs text-muted-foreground">{resolvedDescription}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {SPORT_DEFINITIONS.map((sport) => {
          const checked = selected.includes(sport.code);
          return (
            <Label
              key={sport.code}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2.5 hover:border-primary/40"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(value) => toggleSport(sport.code, value === true)}
                aria-label={t(sportMessageKeys[sport.code])}
              />
              <SportBadge sportCode={sport.code} compact className="border-0 bg-transparent px-0 py-0" />
            </Label>
          );
        })}
      </div>
      {selected.length > 1 ? (
        <div className="max-w-sm space-y-1.5">
          <Label>{t("sport.selector.primary")}</Label>
          <Select
            value={primary}
            onValueChange={(value) => onChange(selected, value as SportCode)}
          >
            <SelectTrigger aria-label={t("sport.selector.primary")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selected.map((sportCode) => {
                const sport = SPORT_DEFINITIONS.find((item) => item.code === sportCode)!;
                return <SelectItem key={sportCode} value={sportCode}>{t(sportMessageKeys[sportCode])}</SelectItem>;
              })}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </fieldset>
  );
}
