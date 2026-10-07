import OfficialSourceLinks from '../components/OfficialSourceLinks';
import {sponsorDemoSource} from '../model/sponsorOpportunities';
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/api";
import s from "../components/Podium.module.css";

type Preview = {
 combinedReview?: {note:string;countedFinishes:number}|null;
 version: "podium-hosted-copy-preview-v1"; state: "unapproved"; payableWei: "0";
 counts: { rounds: number; results: number; finishes: number; unclassifiedFinishes: number };
 classifications: Array<{ id: string; name: string; competition: string | null }>;
 tables: Array<{ slot: number | null; classificationId: string | null; heldReason: string | null;
  candidates: Array<{ beneficiaryId: string; name: string; order: number; evidenceValue: number }> }>;
 participation: Array<{ slot: number | null; heldReason: string | null; rows: Array<{ athleteId: string; name: string; finishes: number; distanceMetres: string | null }> }>;
 results: Array<{ id: string; name: string; club: string | null; competition: string | null; slot: number; status: string; finishTimeMs: string | null; rank: number | null; classificationIds: string[] }>;
};
function time(value: string | null) {
 if (value === null) return "—";
 const ms = BigInt(value), seconds = ms / 1000n;
 return `${seconds / 3600n}:${String(seconds / 60n % 60n).padStart(2, "0")}:${String(seconds % 60n).padStart(2, "0")}.${String(ms % 1000n).padStart(3, "0")}`;
}
const categoryLabel = (category: Preview["classifications"][number]) => [category.competition, category.name].filter(Boolean).join(" · ");
export default function HostedCopyPreview() {
 const auth = useAuth(), userId = auth.user?.id;
 const [loaded, setLoaded] = useState<{ userId: string; value: Preview } | null>(null), [error, setError] = useState(false);
 const [round, setRound] = useState("5"), [category, setCategory] = useState("participation"), [page, setPage] = useState(0);
 useEffect(() => {
  let active = true; setLoaded(null); setError(false);
  if (userId) void apiRequest<Preview>({ path: "/v1/rewards/demo-copy/preview", cache: "no-store" })
   .then(value => { if (value.version !== "podium-hosted-copy-preview-v1" || value.state !== "unapproved" || value.payableWei !== "0") throw Error("invalid_preview"); if (active) setLoaded({ userId, value }); })
   .catch(() => { if (active) setError(true); });
  return () => { active = false; };
 }, [userId]);
 const data = loaded && loaded.userId === userId ? loaded.value : null, slot = round === "season" ? null : Number(round);
 const table = data?.tables.find(t => t.slot === slot && t.classificationId === (category === "clubs" ? null : category));
 const participation = data?.participation.find(p => p.slot === slot);
 const held = category === "participation" ? participation?.heldReason : table?.heldReason;
 const resultRows = data?.results.filter(r => (slot === null || r.slot === slot) && (["participation", "clubs"].includes(category) || r.classificationIds.includes(category))) ?? [];
 return <article className={s.page}>
  <header className={s.heading}><div><span className={s.eyebrow}>Podium · testnet demo</span><h1>Five-round results preview</h1><OfficialSourceLinks selection={{...sponsorDemoSource,eventEditionId:null}} hr={false}/><OfficialSourceLinks selection={{...sponsorDemoSource,eventEditionId:null}} slot={slot??0} hr={false}/><p>Šibenik Trail League · demo closed after Round 5</p></div></header>
  <p className={s.muted}>Exact public sporting results with fictional athlete and club names. These previews await review; no rewards are approved or payable.</p>
  {auth.isLoading ? <p role="status">Loading your account…</p> : !userId ? <p><Link className={s.primary} to="/auth?next=%2Frewards%2Fdemo-copy">Sign in to the demo</Link></p> : error ? <p role="alert">The verified results could not be loaded. Use a provisioned demo account, or try again later.</p> : !data ? <p role="status">Loading verified results…</p> : <>
   <p><strong>{data.counts.rounds} completed rounds</strong> · {data.counts.results} results · {data.counts.finishes} finishes</p>
   {data.combinedReview && <p className="hosted-note">{data.combinedReview.note} Combined calculations count {data.combinedReview.countedFinishes} finishes.</p>}
   <p>{data.counts.unclassifiedFinishes} finishes have no published category membership. They remain in participation and are not assigned a new category.</p>
   <div className={s.toolbar}>
    <label className={s.sort}>Round<select value={round} onChange={e => { setRound(e.target.value); setPage(0); }}><option value="season">Final season</option>{[1,2,3,4,5].map(n => <option key={n} value={n}>Round {n}</option>)}</select></label>
    <label className={s.sort}>Reward group<select value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}><option value="participation">Athlete participation</option><option value="clubs">Combined clubs</option>{data.classifications.map(c => <option key={c.id} value={c.id}>{categoryLabel(c)}</option>)}</select></label>
   </div>
   <h2>{slot === null ? "Final season" : `Round ${slot}`} · {category === "participation" ? "Participation" : category === "clubs" ? "Clubs" : data.classifications.filter(c => c.id === category).map(categoryLabel).join("")}</h2>
   {held ? <p role="alert">Review needed: one athlete has two finished course results in Round 3. Combined rewards for this scope are held. Both source results are preserved below.</p> : <div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Unapproved reward standings</caption><thead><tr>{category === "participation" ? <><th className="p-2">Athlete</th><th className="p-2">Finishes</th><th className="p-2">Distance (m)</th></> : <><th className="p-2">Place</th><th className="p-2">{category === "clubs" ? "Club" : "Athlete"}</th><th className="p-2">{slot === null || category === "clubs" ? "Points" : "Category place"}</th></>}</tr></thead>
    <tbody>{category === "participation" ? participation?.rows.slice(page*20,page*20+20).map(r => <tr key={r.athleteId}><td className="p-2">{r.name}</td><td className="p-2">{r.finishes}</td><td className="p-2">{r.distanceMetres ?? "Unavailable"}</td></tr>) : table?.candidates.slice(page*20,page*20+20).map(r => <tr key={r.beneficiaryId}><td className="p-2">{r.order}</td><td className="p-2">{r.name}</td><td className="p-2">{r.evidenceValue}</td></tr>)}</tbody>
   </table></div>}
   <h2 className="mt-8">Published source results</h2>
   <p className={s.muted}>{resultRows.length} matching records. Places and times are preserved from each course's publication.</p>
   <div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Published results with demo aliases</caption><thead><tr>{["Athlete","Club","Round","Course","Course place","Time","Status"].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{resultRows.slice(page*20,page*20+20).map(r => <tr key={r.id}><td className="p-2">{r.name}</td><td className="p-2">{r.club ?? "—"}</td><td className="p-2">{r.slot}</td><td className="p-2">{r.competition ?? "—"}</td><td className="p-2">{r.rank ?? "—"}</td><td className="whitespace-nowrap p-2 font-mono">{time(r.finishTimeMs)}</td><td className="p-2">{r.status}</td></tr>)}</tbody></table></div>
   <nav aria-label="Results pages" className={s.toolbar}><button className={s.secondary} disabled={page===0} onClick={() => setPage(p => p-1)}>Previous</button><span>Page {page+1}</span><button className={s.secondary} disabled={(page+1)*20>=Math.max(resultRows.length,category==="participation"?(participation?.rows.length??0):(table?.candidates.length??0))} onClick={() => setPage(p => p+1)}>Next</button></nav>
  </>}
 </article>;
}
