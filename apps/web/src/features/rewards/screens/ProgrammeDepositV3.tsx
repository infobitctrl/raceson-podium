import RewardExplorerLink from "../components/RewardExplorerLink";
import { useEffect, useRef, useState } from "react";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import type { ProgrammeDepositReviewV3 } from "@raceson/domain/rewards/programme-deposit-v3";
import { useI18n } from "@/shared/i18n/I18nContext";
import { inspectProgrammeDepositV3, reviewProgrammeDepositV3 } from "../data/programmeDepositV3";
import type { DetectedRewardWallet } from "../data/browserWallet";
import type { PendingProgrammeDeposit } from "../data/browserProgrammeDeposit";

const button = "rounded-md border px-3 py-2 text-sm disabled:opacity-50";
const field = "mt-1 block w-full rounded-md border bg-background p-2 text-sm";
const errors = ["deposit_pending", "deposit_changed", "deposit_wrong_funder", "deposit_wrong_network", "deposit_unknown", "deposit_rejected", "deposit_storage"] as const;

/** Shared standalone/classic organizer flow. A send is only a click handler;
 * reloads/effects can inspect local metadata but never request a transaction. */
export default function ProgrammeDepositV3({ record, onConfirmed }: { record: SavedRewardPlanningDraft; onConfirmed: () => void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("1"), [review, setReview] = useState<ProgrammeDepositReviewV3 | null>(null);
  const [confirmed, setConfirmed] = useState(false), [wallets, setWallets] = useState<DetectedRewardWallet[]>([]), [walletId, setWalletId] = useState("");
  const [pending, setPending] = useState<PendingProgrammeDeposit | null>(null), [hash, setHash] = useState("");
  const [error, setError] = useState<typeof errors[number] | "failed" | null>(null), [status, setStatus] = useState<"pending" | "confirmed" | "reverted" | null>(null);
  const epoch = useRef(0), inFlight = useRef(false), controller = useRef<AbortController | null>(null);
  const fixedScope = `${record.chainId}:${record.draftId}:${record.revision}`;
  const liveScope = useRef(fixedScope); liveScope.current = fixedScope;
  function clearReview() { epoch.current++; controller.current?.abort(); setReview(null); setConfirmed(false); setError(null); setStatus(null); setBusy(false); }
  function fail(e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
    setError(errors.find(value => value === code) ?? "failed"); setReview(null); setConfirmed(false);
  }
  useEffect(() => {
    if (!open || record.chainId !== 31337) return;
    let active = true, dispose: (() => void) | undefined;
    setReady(false);
    const restore = async () => {
      try {
        const module = await import("../data/browserProgrammeDeposit");
        if (!active) return;
        const p = module.readPendingProgrammeDeposit(window.localStorage, record.chainId, record.draftId);
        setPending(p); setHash(p?.transactionHash ?? ""); setReady(true);
      } catch { if (active) { setReady(false); setError("deposit_storage"); } }
    };
    void restore();
    void import("../data/browserWallet").then(module => {
      if (active) dispose = module.discoverRewardWallets(window, value => { if (active) setWallets(value); });
    }).catch(() => { if (active) setError("failed"); });
    const storage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== `raceson.programme-deposit.v1:${record.chainId}:${record.draftId}`) return;
      clearReview(); void restore();
    };
    window.addEventListener("storage", storage);
    return () => { active = false; controller.current?.abort(); dispose?.(); window.removeEventListener("storage", storage); };
  }, [open, record.chainId, record.draftId, record.revision]);
  async function run(action: (current: () => boolean, signal: AbortSignal) => Promise<void>) {
    if (inFlight.current || !ready) return;
    inFlight.current = true; setBusy(true); setError(null); setStatus(null);
    const stamp = ++epoch.current, abort = new AbortController(); controller.current = abort;
    const current = () => epoch.current === stamp && liveScope.current === fixedScope && !abort.signal.aborted;
    try { await action(current, abort.signal); } catch (e) { if (current()) fail(e); }
    finally { inFlight.current = false; if (current()) setBusy(false); }
  }
  const selected = wallets.find(w => w.id === walletId);
  const quote = review?.status === "ready" ? review.quote : null;
  const setJournal = (p: PendingProgrammeDeposit | null) => { setPending(p); setHash(p?.transactionHash ?? ""); };
  const networkBlocked = record.chainId !== 31337;
  return <section aria-labelledby="programme-deposit-heading" className="space-y-3 rounded-lg border p-4">
    <h3 id="programme-deposit-heading" className="font-semibold">{t("rewards.depositV3.title")}</h3>
    <p className="text-sm text-muted-foreground">{t(networkBlocked ? "rewards.depositV3.testnet" : "rewards.depositV3.help")}</p>
    {!networkBlocked && !open ? <button type="button" className={button} onClick={() => setOpen(true)}>{t("rewards.depositV3.open")}</button> : null}
    {open && !networkBlocked ? <>
      {!ready && !error ? <p role="status">{t("rewards.loading")}</p> : null}
      {pending ? <div className="space-y-3 rounded-md border border-amber-500 p-3">
        <h4 className="font-medium">{t("rewards.depositV3.pendingTitle")}</h4>
        <p className="text-sm">{t("rewards.depositV3.pendingHelp")}</p>
        <label className="block text-sm">{t("rewards.depositV3.hash")}<input className={`${field} font-mono`} value={hash} readOnly={!!pending.transactionHash}
          disabled={busy} spellCheck={false} autoComplete="off" onChange={e => setHash(e.target.value.trim().toLowerCase())} /></label>
        <button type="button" className={button} disabled={busy || !ready || !/^0x[0-9a-f]{64}$/.test(hash)} onClick={() => void run(async (current, signal) => {
          const module = await import("../data/browserProgrammeDeposit"); if (!current()) return;
          const result = await module.reconcileBrowserProgrammeDeposit(pending, hash, () => inspectProgrammeDepositV3(record, pending.quote, hash),
            { storage: window.localStorage, locks: navigator.locks, current, signal, pending: p => { if (current()) setJournal(p); } });
          if (current()) { setStatus(result.status); if (result.status !== "pending") { setReview(null); setConfirmed(false); onConfirmed(); } }
        })}>{t("rewards.depositV3.inspect")}</button>
      </div> : <>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 text-sm">{t("rewards.depositV3.amount")}<input className={field} inputMode="decimal" autoComplete="off" value={amount} disabled={busy || !ready}
            onChange={e => { clearReview(); setAmount(e.target.value); }} /></label>
          <button type="button" className={button} disabled={busy || !ready} onClick={() => void run(async current => {
            setReview(null); setConfirmed(false); const value = await reviewProgrammeDepositV3(record, amount); if (current()) setReview(value);
          })}>{t("rewards.depositV3.review")}</button>
        </div>
        {review?.status === "blocked" ? <p role="status" className="rounded-md border p-3 text-sm">{t(`rewards.depositV3.blocked.${review.reason}`)}</p> : null}
        {quote ? <div className="space-y-3 rounded-md bg-muted/40 p-3">
          <h4 className="font-medium">{t("rewards.depositV3.exact")}</h4>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt>{t("rewards.depositV3.network")}</dt><dd>{t("rewards.depositV3.local")}</dd></div>
            <div><dt>{t("rewards.depositV3.value")}</dt><dd className="break-all font-mono">{new Intl.NumberFormat(locale).format(BigInt(quote.amountWei) / 10n ** 18n)}{locale === "hr" ? "," : "."}{(BigInt(quote.amountWei) % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "") || "0"} MON<br /><span className="text-xs">{quote.amountWei} wei</span></dd></div>
            <div><dt>{t("rewards.depositV3.from")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={record.chainId} kind="address" value={quote.funderAddress}/></dd></div>
            <div><dt>{t("rewards.depositV3.to")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={record.chainId} kind="address" value={quote.address}/></dd></div>
          </dl>
          <p className="text-sm">{t("rewards.depositV3.expiry")}</p>
          <label className="block text-sm">{t("rewards.depositV3.wallet")}<select className={field} disabled={busy} value={walletId}
            onChange={e => { setWalletId(e.target.value); setConfirmed(false); }}><option value="">{t("rewards.depositV3.choose")}</option>
            {wallets.map(w => <option key={w.id} value={w.id}>{w.name ?? t("rewards.depositV3.browserWallet")}</option>)}</select></label>
          {!wallets.length ? <p className="text-sm">{t("rewards.depositV3.noWallet")}</p> : null}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} disabled={busy}
            onChange={e => setConfirmed(e.target.checked)} /><span>{t("rewards.depositV3.consent")}</span></label>
          <button type="button" className={button} disabled={busy || !confirmed || !selected} onClick={() => void run(async (current, signal) => {
            if (!confirmed || !selected) return;
            const module = await import("../data/browserProgrammeDeposit"); if (!current()) return;
            await module.sendBrowserProgrammeDeposit(selected.provider, quote, () => reviewProgrammeDepositV3(record, amount),
              { storage: window.localStorage, locks: navigator.locks, current, signal, pending: p => { if (current()) setJournal(p); } });
            if (current()) { setReview(null); setConfirmed(false); setStatus("pending"); }
          })}>{t("rewards.depositV3.send")}</button>
        </div> : null}
      </>}
      {busy ? <p role="status">{t("rewards.depositV3.working")}</p> : null}
      {status ? <p role="status" className="text-sm">{t(`rewards.depositV3.status.${status}`)}</p> : null}
      {error ? <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{t(`rewards.depositV3.error.${error}`)}</p> : null}
    </> : null}
  </section>;
}
