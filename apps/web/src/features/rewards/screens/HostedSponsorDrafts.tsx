import HostedAllocationPreview from './HostedAllocationPreview';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from '@/lib/api';
import { decodeRewardSetup, decodeSavedRewardSetup, previewRewardSetup, updateSetupNode, type RewardDistributionSetup, type SavedRewardSetup } from '@raceson/domain/rewards/distribution-setup';
import SponsorPotPlanner from '../components/SponsorPotPlanner';
import SponsorPrizeEditor from '../components/SponsorPrizeEditor';
import { setupAmount } from '../model/setupAmount';

type ServerPreview = { budgetWei: string; retainedWei: string | null; complete: boolean };
type DraftResponse = { id: string; configuration: RewardDistributionSetup; record?: SavedRewardSetup; preview: ServerPreview; combinedReview?: {note:string} };
type Pending = { requestId: string; expectedRevision: number; configuration: RewardDistributionSetup };
const base = '/v1/rewards/demo-copy/sponsor-setups';
export default function HostedSponsorDrafts() {
 const [items, setItems] = useState<SavedRewardSetup[]>([]), [draft, setDraft] = useState<{ id: string; revision: number; configuration: RewardDistributionSetup } | null>(null);
 const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [slot, setSlot] = useState(0);
 const [reviewNote,setReviewNote]=useState('Combined results require sporting review.');
 const [serverPreview, setServerPreview] = useState<ServerPreview | null>(null), [pending, setPending] = useState<Pending | null>(null), [conflict, setConflict] = useState(false);
 const alive = useRef(true), lock = useRef(false);
 useEffect(() => { alive.current = true; void apiRequest<{ items: unknown[] }>({ path: base, cache: 'no-store' }).then(r => { if (alive.current) setItems(r.items.map(v => decodeSavedRewardSetup(v,10143))); }).catch(() => { if (alive.current) setError('Campaigns could not be loaded. Try reopening Campaigns.'); }).finally(() => { if (alive.current) setBusy(false); }); return () => { alive.current = false; }; }, []);
 async function open(id?: string) {
  if (lock.current) return;
  if (notice === 'Unsaved changes' && !window.confirm('Discard unsaved changes and open the saved campaign?')) return;
  lock.current = true; setBusy(true); setError(''); setNotice('');
  try {
   const r = await apiRequest<DraftResponse>({ path: id ? `${base}/${id}` : '/v1/rewards/demo-copy/sponsor-source', cache: 'no-store' });
   const value = id ? decodeSavedRewardSetup(r.record,10143,id) : { id: r.id, revision: 0, configuration: decodeRewardSetup(r.configuration) };
   if (alive.current) { setDraft(value); setServerPreview(r.preview); setReviewNote(r.combinedReview?.note ?? 'Combined results require sporting review.'); setPending(null); setConflict(false); setSlot(0); }
  } catch { if (alive.current) setError('The verified campaign could not be opened. Try again.'); }
  finally { lock.current = false; if (alive.current) setBusy(false); }
 }
 function change(configuration: RewardDistributionSetup) { if (!busy && !pending && !conflict && draft) { setDraft({ ...draft, configuration }); setServerPreview(null); setNotice('Unsaved changes'); } }
 async function save() {
  if (lock.current || !draft || conflict) return;
  let request: Pending;
  try { request = pending ?? { requestId: crypto.randomUUID(), expectedRevision: draft.revision, configuration: decodeRewardSetup(draft.configuration) }; }
  catch { setError('Check the budget, percentages and prize settings.'); return; }
  lock.current = true; setBusy(true); setError(''); setPending(request);
  try {
   const r = await apiRequest<DraftResponse>({ path: `${base}/${draft.id}`, method: 'PATCH', cache: 'no-store', body: request });
   const record = decodeSavedRewardSetup(r.record,10143,draft.id);
   if (alive.current) { setDraft(record); setItems(rows => [record,...rows.filter(row => row.id !== record.id)]); setServerPreview(r.preview); setReviewNote(r.combinedReview?.note ?? 'Combined results require sporting review.'); setPending(null); setNotice(`Saved · revision ${record.revision}`); }
  } catch (e) {
   if (alive.current) {
    if (e instanceof ApiError && e.status === 409) { setConflict(true); setPending(null); setError('This campaign changed. Reopen the saved version before editing.'); }
    else if (e instanceof ApiError && [400,401,403,404].includes(e.status ?? 0)) { setPending(null); setError(e.message); }
    else setError('Save could not be confirmed. Retry this save to avoid creating a duplicate revision.');
   }
  } finally { lock.current = false; if (alive.current) setBusy(false); }
 }
 let preview: ReturnType<typeof previewRewardSetup> | null = null;
 try { if (draft) preview = previewRewardSetup(draft.configuration); } catch { /* Keep incomplete input editable. */ }
 const pot = draft?.configuration.root.children[slot], disabled = busy || !!pending || conflict;
 return <article className="hosted-campaigns">
  <header><p className="hosted-kicker">Sponsor workspace · Monad testnet</p><h1>Plan rewards for the league</h1><p>Select the five completed rounds, set the reward split, and save a campaign for review.</p></header>
  {error && <p className="hosted-error" role="alert">{error}</p>}
  <section className="hosted-source"><div><h2>Šibenik Trail League</h2><p>Closed after Round 5 · 10 courses · 7 published athlete classifications</p><p>Short and Long routes · combined club standings · league participation</p></div><button disabled={busy || !!pending || !!draft} onClick={() => open()}>Configure league rewards</button></section>
  <section className="hosted-library"><h2>Your saved campaigns</h2>{draft && !pending && <button disabled={busy} onClick={() => open()}>New campaign for this league</button>}{busy && !draft ? <p role="status">Loading campaigns…</p> : !items.length ? <p>No campaigns saved yet.</p> : <ul>{items.map(r => <li key={r.id}><button disabled={busy || !!pending} onClick={() => open(r.id)}>{r.configuration.name}</button><span>Revision {r.revision} · {r.configuration.budgetMon} test MON planned</span></li>)}</ul>}</section>
  {draft && <section className="hosted-editor" aria-label="Campaign editor">
   <div className="hosted-editor-head"><label>Campaign name<input aria-label="Campaign name" maxLength={100} value={draft.configuration.name} disabled={disabled} onChange={e => change({ ...draft.configuration, name: e.target.value })} /></label><div><button disabled={busy || conflict || !preview} onClick={save}>{pending ? 'Retry save' : 'Save campaign'}</button>{draft.revision > 0 && <button disabled={busy || !!pending} onClick={() => open(draft.id)}>Reopen saved version</button>}</div></div>
   <p role="status">{notice || (draft.revision ? `Saved revision ${draft.revision}` : 'New draft · not saved')}</p>
   <label className="hosted-budget">Planned budget · test MON<input aria-label="Planned budget · test MON" inputMode="decimal" value={draft.configuration.budgetMon} disabled={disabled} onChange={e => change({ ...draft.configuration, budgetMon: e.target.value })}/></label>
   <p className="hosted-note">Draft only. Approved: 0 · Funded: 0 · Payable: 0 test MON. Contract creation and claims are not enabled.</p>
   {draft.revision>0 && serverPreview && !pending && !conflict ? <HostedAllocationPreview key={`${draft.id}:${draft.revision}`} id={draft.id} revision={draft.revision}/> : <p>Save your current rules to preview source-derived allocations.</p>}
   <SponsorPotPlanner configuration={draft.configuration} onChange={change} onChooseRewards={setSlot} disabled={disabled} hr={false}/>
   <div className="hosted-pot-tabs" role="group" aria-label="Reward pots">{draft.configuration.root.children.map((p,i) => <button key={p.id} aria-pressed={slot===i} onClick={() => setSlot(i)}>{p.name}</button>)}</div>
   {pot && <><h2>{pot.name} reward categories</h2><p>Set each category's percentage of this pot. A 0% category keeps its place in the source but receives no planned budget.</p>
    {(slot===0 || slot===3) && <p className="hosted-note">{reviewNote}</p>}
    <div className="hosted-groups">{pot.children.map(n => { const row = preview?.rows.find(r => r.id===n.id), proportional = n.rule?.basis==='participation'; return <details key={n.id}><summary><span>{n.name}</span><strong>{n.shareBps/100}% · {setupAmount(row?.amountWei ?? null,false)} test MON</strong></summary><div className="hosted-group-body"><label>Share of {pot.name}<input aria-label={`${pot.name} / ${n.name} share %`} type="number" min="0" max="100" step="0.01" value={n.shareBps/100} disabled={disabled} onChange={e => { if (e.target.value!=='' && e.target.validity.valid) change({ ...draft.configuration, root: updateSetupNode(draft.configuration.root,n.id,v => ({ ...v,shareBps: Math.round(Number(e.target.value)*100) })) }); }}/></label>{proportional ? <p>Proportional to verified {n.name.toLowerCase()}; minimum one finish. Eligibility still requires review.</p> : <SponsorPrizeEditor name={`${pot.name} / ${n.name}`} shares={n.rule!.sharesBps} slots={row?.slots ?? []} disabled={disabled} hr={false} onChange={shares => change({ ...draft.configuration, root: updateSetupNode(draft.configuration.root,n.id,v => ({ ...v,rule: { ...v.rule!,sharesBps: shares } })) })}/>}</div></details>; })}</div></>}
   <p>{preview ? `Planned: ${setupAmount(preview.budgetWei,false)} test MON · ${preview.retainedWei===null ? 'Check overallocated percentages' : `${setupAmount(preview.retainedWei,false)} test MON unallocated`}` : 'Enter a valid budget to preview the split.'}</p>
   {serverPreview && draft.revision > 0 && <p className="hosted-note">Saved totals verified by the server · {setupAmount(BigInt(serverPreview.budgetWei),false)} test MON planned · revision {draft.revision}.</p>}
  </section>}
 </article>;
}
