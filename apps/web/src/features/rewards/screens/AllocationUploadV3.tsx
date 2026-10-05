import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/shared/i18n/I18nContext";
import { requestAllocationUploadV3, type AllocationUploadContextV3, type AllocationUploadRequestV3 } from "../data/allocationUploadV3";

type Data = Awaited<ReturnType<typeof requestAllocationUploadV3>>;
const ProgrammeExecutionStatusV3 = lazy(() => import("./ProgrammeExecutionStatusV3"));
const ProgrammeActionsV3 = lazy(() => import("./ProgrammeActionsV3"));
const RoundPublicationV3 = lazy(() => import("./RoundPublicationV3"));
const OrganizerClubAwardsV3 = lazy(() => import("../components/OrganizerClubAwardsV3"));
export default function AllocationUploadV3({ context, dirty }: { context: AllocationUploadContextV3; dirty: boolean }) {
  const { t, locale } = useI18n(), [data, setData] = useState<Data | null>(null), [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false), [consent, setConsent] = useState(false), [pending, setPending] = useState<AllocationUploadRequestV3 | null>(null);
  const generation = useRef(0), sending = useRef(false);
  const executionContext = useMemo(() => data?.prepared ? { ...context, uploadId: data.prepared.id,
    packageHash: data.prepared.packageHash } : null, [context, data?.prepared]);
  // Parent remounts this child with the Auth-scoped approval panel. No wallet
  // provider, private export or optimistic on-chain status belongs here.
  useEffect(() => {
    const current = ++generation.current;
    void requestAllocationUploadV3(context).then(v => { if (current === generation.current) setData(v); })
      .catch(() => { if (current === generation.current) setFailed(true); })
      .finally(() => { if (current === generation.current) setBusy(false); });
    return () => { generation.current = current + 1; };
  }, [context]);
  async function act(prepare = false) {
    if (sending.current || busy || dirty || (prepare && (!consent || !data?.current || data.prepared))) return;
    const request = pending ?? (prepare ? { requestId: crypto.randomUUID(), contextHash: context.contextHash, documentHash: context.documentHash } : null);
    const current = generation.current; sending.current = true; setBusy(true); setFailed(false); setData(null); setConsent(false);
    if (request) setPending(request);
    try { const result = await requestAllocationUploadV3(context, request ?? undefined);
      if (current === generation.current) { setData(result); setPending(null); }
    } catch { if (current === generation.current) setFailed(true); }
    finally { sending.current = false; if (current === generation.current) setBusy(false); }
  }
  return <section className="space-y-3 rounded-md border p-3" aria-label={t("rewards.upload.title")}>
    <h5 className="font-semibold">{t("rewards.upload.title")}</h5>
    <p className="text-sm">{t("rewards.upload.help")}</p>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert">{t(pending ? "rewards.historical.uncertain" : "rewards.historical.error")}</p> : null}
    {data?.prepared ? <div className="space-y-2 text-sm">
      <p role="status">{t("rewards.upload.prepared", { count: Number(data.entitlementCount) })}{" · "}{new Date(data.prepared.preparedAt).toLocaleString(locale)}</p>
      <details><summary>{t("rewards.upload.reference")}</summary><p className="break-all font-mono text-xs">{data.prepared.packageHash}</p></details>
    </div> : null}
    {data && !data.current ? <p role="status">{t("rewards.allocationApproval.stale")}</p> : null}
    {data && !data.prepared ? <>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={busy || dirty || !data.current}
        onChange={event => setConsent(event.target.checked)} /><span>{t("rewards.upload.confirm")}</span></label>
      <button type="button" className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
        disabled={busy || dirty || !consent || !data.current} onClick={() => void act(true)}>{t("rewards.upload.prepare")}</button>
    </> : null}
    {!busy ? <button type="button" disabled={dirty} className="rounded border px-3 py-2 text-sm disabled:opacity-50"
      onClick={() => void act()}>{t(pending ? "rewards.upload.retry" : "rewards.historical.reload")}</button> : null}
    <p className="text-sm text-muted-foreground">{t("rewards.upload.noPayment")}</p>
    {executionContext ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}>
      <RoundPublicationV3 key={`publication:${executionContext.uploadId}:${dirty}`} context={executionContext} dirty={dirty} />
      <ProgrammeExecutionStatusV3 key={`${executionContext.uploadId}:${dirty}`} context={executionContext} dirty={dirty} />
      <ProgrammeActionsV3 key={`actions:${executionContext.uploadId}:${dirty}`} context={executionContext} dirty={dirty} />
      <OrganizerClubAwardsV3 context={{ chainId: executionContext.chainId as 31337 | 10143, uploadId: executionContext.uploadId,
        draftId: executionContext.draftId, approvalId: executionContext.approvalId, slot: executionContext.slot,
        campaignAddress: executionContext.campaignAddress }} dirty={dirty} />
    </Suspense> : null}
  </section>;
}
