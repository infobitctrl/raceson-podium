import editorial from "./RewardEditorial.module.css";
import { useState } from "react";
import { useI18n } from "@/shared/i18n/I18nContext";
import { formatTestMon } from "../model/athleteRewards";
import { productCopy } from "../model/productCopy";

import type { DistributionNode } from "../model/allocationTree";

function Branch({ node, parent }: { node: DistributionNode; parent: bigint }) {
  const { t, locale } = useI18n(); const [open, setOpen] = useState(false);
  const amount = node.wei === 0n ? "0" : formatTestMon(node.wei.toString(), locale);
  const share = parent > 0n ? Number(node.wei * 10000n / parent) : 0;
  return <li className="min-w-0 border-l border-border pl-3">
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer py-2 text-sm"><span className="break-all font-medium">{node.label}</span> · <span className="break-all tabular-nums">{amount} {t("rewards.testMon")}</span>
      <progress className={editorial.potProgress} max={10000} value={share} aria-label={node.label} aria-valuetext={`${share / 100}%`} /></summary>
      {open && node.children ? <ul className="mt-3 space-y-2">{node.children.map(child => <Branch key={child.id} node={child} parent={node.wei} />)}</ul> : null}
    </details>
  </li>;
}
export default function RewardDistributionTree({ root }: { root: DistributionNode }) {
  const { locale } = useI18n(), copy = productCopy(locale);
  return <details className="rounded-lg border border-border p-4">
    <summary className="cursor-pointer font-semibold">{copy.tree}</summary><p className="my-3 text-sm text-muted-foreground">{copy.treeHelp}</p>
    <ul aria-label={copy.tree}><Branch key={root.id} node={root} parent={root.wei} /></ul>
  </details>;
}
