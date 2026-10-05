import RewardExplorerLink from "./RewardExplorerLink";
import { lazy, Suspense, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getOperatorClubRequests } from "../data/organizerClubs";
import { organizerErrorKey, type RewardNetwork } from "../model/organizerRewards";
import type { OperatorClubSelection } from "../model/organizerClubs";
import { usePrivatePage } from "./usePrivatePage";
const Review=lazy(()=>import("./OrganizerClubReview"));
export default function OrganizerClubTreasuries({programmeId,chainId,onBack,onAccessLost}:{programmeId:string;chainId:RewardNetwork;onBack:()=>void;onAccessLost:(error:unknown)=>void}) {
  const {t}=useI18n(),[selection,setSelection]=useState<OperatorClubSelection|null>(null);
  const fetchPage=useCallback((after:string|null)=>getOperatorClubRequests(programmeId,chainId,after),[programmeId,chainId]);
  const page=usePrivatePage(fetchPage,onAccessLost);
  if(selection)return <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><Review key={selection.requestId} selection={selection}
    onBack={()=>setSelection(null)} onAccessLost={onAccessLost}/></Suspense>;
  return <section aria-labelledby="operator-club-treasuries" className="space-y-4">
    <Button variant="ghost" onClick={onBack}>{t("rewards.organizer.backProgrammes")}</Button>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="operator-club-treasuries" className="text-xl font-semibold">{t("rewards.clubReview.title")}</h2>
      <Button variant="outline" disabled={page.loading} onClick={()=>void page.load()}>{t("rewards.organizer.refreshRequests")}</Button></div>
    <p className="text-sm text-muted-foreground">{t("rewards.clubReview.intro")}</p>
    {page.loading?<p role="status">{t("rewards.loading")}</p>:null}
    {page.error?<p role="alert">{t(organizerErrorKey(page.error))}</p>:!page.loading&&!page.items.length?<p className="rounded-xl border border-dashed p-5">{t("rewards.clubReview.empty")}</p>:null}
    <ul className="space-y-3">{page.items.map(r=><li key={r.requestId} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
      <h3 className="break-words font-semibold">{r.clubName??t("rewards.clubReview.fallback")}</h3><p className="break-all font-mono text-xs"><RewardExplorerLink chainId={chainId} kind="address" value={r.address}/></p>
      <p className="text-sm text-muted-foreground">{t(`rewards.organizer.destination.${r.nominationStatus}`)}</p>
      <Button variant="outline" disabled={page.loading} onClick={()=>setSelection({programmeId,chainId,requestId:r.requestId,clubId:r.clubId,address:r.address,requestedAt:r.requestedAt})}>{t("rewards.organizer.openReview")}</Button>
    </li>)}</ul>
    {page.nextCursor?<Button variant="outline" disabled={page.loading} onClick={()=>void page.load(page.nextCursor)}>{t("rewards.loadMore")}</Button>:null}
  </section>;
}
