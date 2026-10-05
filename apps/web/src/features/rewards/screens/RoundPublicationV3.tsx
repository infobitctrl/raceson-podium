import { useEffect, useRef, useState } from "react";
import type { RoundPublicationScopeV3, RoundPublicationViewV3, RoundPublicationChangeV3 } from "@raceson/domain/rewards/round-publication-v3";
import { useI18n } from "@/shared/i18n/I18nContext";
import { requestRoundPublicationV3 } from "../data/roundPublicationV3";
type Props = { context: RoundPublicationScopeV3; dirty: boolean };
export default function RoundPublicationV3(props: Props) {
  return <PublicationDetails key={JSON.stringify([props.context, props.dirty])} {...props} />;
}
function PublicationDetails({ context, dirty }: Props) {
  const { t, locale } = useI18n(), [data, setData] = useState<RoundPublicationViewV3 | null>(null);
  const [busy, setBusy] = useState(true), [failed, setFailed] = useState(false), [consent, setConsent] = useState(false);
  const [pending, setPending] = useState<RoundPublicationChangeV3 | null>(null), generation = useRef(0), sending = useRef(false);
  useEffect(() => {
    const n = ++generation.current;
    void requestRoundPublicationV3(context).then(v => { if (generation.current === n) setData(v); })
      .catch(() => { if (generation.current === n) setFailed(true); }).finally(() => { if (generation.current === n) setBusy(false); });
    return () => { generation.current = n + 1; };
  }, [context]);
  async function act(action?: "start" | "publish") {
    if (busy || sending.current || dirty || (action && (!consent || !data?.supported || !data.current
      || (action === "start" ? Boolean(data.review) : !data.canPublish)))) return;
    const request = pending ?? (action ? { action, requestId: crypto.randomUUID(), reviewId: action === "publish" ? data!.review!.id : null,
      packageHash: context.packageHash } : null), n = generation.current;
    sending.current = true; setBusy(true); setFailed(false); setData(null); setConsent(false); if (request) setPending(request);
    try { const value = await requestRoundPublicationV3(context, request ?? undefined);
      if (generation.current === n) { setData(value); setPending(null); }
    } catch { if (generation.current === n) setFailed(true); }
    finally { sending.current = false; if (generation.current === n) setBusy(false); }
  }
  const format = (date: string) => new Date(date).toLocaleString(locale);
  return <section className="space-y-3 rounded-md border p-3" aria-label={t("rewards.roundPublication.title")}>
    <h5 className="font-semibold">{t("rewards.roundPublication.title")}</h5>
    <p className="text-sm">{t("rewards.roundPublication.help")}</p>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert">{t(pending ? "rewards.historical.uncertain" : "rewards.historical.error")}</p> : null}
    {data && !data.supported ? <p>{t("rewards.roundPublication.unsupported")}</p> : null}
    {data && !data.current ? <p role="status">{t("rewards.allocationApproval.stale")}</p> : null}
    {data?.review ? <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div><dt>{t("rewards.roundPublication.started")}</dt><dd>{format(data.review.startedAt)}</dd></div>
      <div><dt>{t("rewards.roundPublication.ends")}</dt><dd>{format(data.review.endsAt)}</dd></div>
    </dl> : null}
    {data?.publication ? <p role="status">{t("rewards.roundPublication.published", { date: format(data.publication.publishedAt) })}</p> : null}
    {data?.review && !data.publication && !data.canPublish ? <p role="status">{t("rewards.roundPublication.waiting")}</p> : null}
    {data?.supported && data.current && !data.publication ? <>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={busy || dirty || Boolean(data.review && !data.canPublish)}
        onChange={e => setConsent(e.target.checked)} /><span>{t(data.review ? "rewards.roundPublication.confirmPublish" : "rewards.roundPublication.confirmStart")}</span></label>
      <button type="button" className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
        disabled={busy || dirty || !consent || Boolean(data.review && !data.canPublish)} onClick={() => void act(data.review ? "publish" : "start")}>
        {t(data.review ? "rewards.roundPublication.publish" : "rewards.roundPublication.start")}</button>
    </> : null}
    {!busy ? <button type="button" disabled={dirty} className="rounded border px-3 py-2 text-sm disabled:opacity-50"
      onClick={() => void act()}>{t(pending ? "rewards.upload.retry" : "rewards.historical.reload")}</button> : null}
    <p className="text-sm text-muted-foreground">{t("rewards.roundPublication.noPayment")}</p>
  </section>;
}
