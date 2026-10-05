import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { LeagueParticipationMetrics, ParticipationIssueCode } from "@raceson/domain/rewards/league-participation-metrics";
import { readParticipationMetrics } from "../data/participationMetrics";
import type { SetupEventSelection } from "./RewardSetupEvent";
import s from "./RewardSetup.module.css";
import m from "./RewardLeagueMetrics.module.css";
const RewardParticipationReview = lazy(() => import("./RewardParticipationReview"));

const issueText = (code: ParticipationIssueCode, hr: boolean) => ({
  duplicate_athlete_round: hr ? "Više rezultata istog sportaša u jednom kolu — potrebna provjera." : "Multiple results for one athlete in a round — review required.",
  missing_distance: hr ? "Nedostaje udaljenost. Broj završetaka ostaje vidljiv." : "Distance is missing. Finish count remains visible.",
  unknown_outcome: hr ? "Status nastupa nije razriješen." : "Participation outcome is unresolved.",
  invalid_finish_time: hr ? "Završetak nema valjano vrijeme." : "A finished result has no valid finish time.",
  unclassified_finish: hr ? "Završetak nema kategoriju. Zasebno provjerite pravo na kategorijsku nagradu." : "A finish has no classification. Review category awards separately.",
  unattributed_club: hr ? "Klub nije naveden u rezultatu. Provjerite je li nastup neovisan." : "No represented club on the result. Confirm whether participation was unaffiliated.",
})[code];

/** Inspectable source progress, deliberately separate from earned awards. */
type Props = { selection: SetupEventSelection; hr: boolean; onReviewUnsavedChange?: (value: boolean) => void };
function MetricsPanel({ selection, hr, onReviewUnsavedChange }: Props) {
  const [metrics, setMetrics] = useState<LeagueParticipationMetrics | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"athletes" | "clubs">("athletes"), [search, setSearch] = useState("");
  const [page, setPage] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const [reviewUnsaved, setReviewUnsaved] = useState(false);
  useEffect(() => { onReviewUnsavedChange?.(reviewUnsaved); return () => onReviewUnsavedChange?.(false); }, [reviewUnsaved, onReviewUnsavedChange]);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  async function load() {
    const request = ++generation.current;
    setBusy(true); setFailed(false); setLoaded(false); setMetrics(null); setSelected(null); setPage(0);
    try { const data = await readParticipationMetrics(selection); if (request === generation.current) { setMetrics(data); setLoaded(true); } }
    catch { if (request === generation.current) setFailed(true); }
    finally { if (request === generation.current) setBusy(false); }
  }
  const km = (metres: string) => new Intl.NumberFormat(hr ? "hr" : "en", { maximumFractionDigits: 3 }).format(Number(metres) / 1000);
  const rows = metrics ? (tab === "athletes" ? metrics.athletes : metrics.clubs).filter(r =>
    `${r.name ?? ""} ${r.id}`.toLowerCase().includes(search.toLowerCase())) : [];
  const visible = rows.slice(page * 25, (page + 1) * 25);
  const selectedRow = rows.find(r => r.id === selected);
  const contributions = metrics?.contributions.filter(c => tab === "clubs" ? c.clubId === selected : c.athleteId === selected) ?? [];
  const selectedIds = new Set(selectedRow?.resultIds ?? []);
  const issues = metrics?.issues.filter(issue => issue.resultIds.some(id => selectedIds.has(id))) ?? [];
  return <section className={`${s.card} ${m.panel}`} aria-label={hr ? "Podaci za nagrade sudjelovanja" : "Participation reward data"}>
    <div className={m.header}><div><span className={s.eyebrow}>{hr ? "Liga · Podaci" : "League · Data"}</span>
      <h3>{hr ? "Završeci i kilometri" : "Finishes and kilometres"}</h3>
      <p className={s.small}>{hr ? "Pregled službenih rezultata za sportaše i klubove prije određivanja nagrada." : "Inspect published athlete and club contributions before assigning rewards."}</p>
    </div><button className={s.button} disabled={busy || reviewUnsaved} onClick={() => void load()}>{busy ? (hr ? "Učitavanje…" : "Loading…") : loaded ? (hr ? "Osvježi podatke" : "Refresh data") : (hr ? "Pregledaj podatke" : "View data")}</button></div>
    {failed ? <p role="alert" className={s.notice}>{hr ? "Podatke nije moguće provjeriti. Ponovno učitajte izvor i pokušajte opet." : "Could not verify source data. Reload the source and try again."}</p> : null}
    {loaded && !metrics ? <p role="status">{hr ? "Nema uvezenih rezultata za ovaj program. Nula se ne pretpostavlja." : "No imported results for this programme. This does not mean zero finishes."}</p> : null}
    {metrics ? <>
      <p className={s.notice}>{metrics.sourceKind === "synthetic_rehearsal" ? (hr ? "Sintetički probni podaci. " : "Synthetic rehearsal data. ") : ""}
        {hr ? `${metrics.availableRounds} od ${metrics.plannedRounds} kola · Napredak, ne konačne nagrade.` : `${metrics.availableRounds} of ${metrics.plannedRounds} rounds · Progress, not final awards.`}
        {" "}{hr ? "Snimka izvora" : "Source captured"}: {metrics.capturedAt.slice(0, 10)}.
      </p>
      <dl className={m.summary}>
        <div><dt>{hr ? "Zapisi završetaka" : "Finish rows"}</dt><dd>{metrics.summary.rawFinishes}</dd></div>
        <div><dt>{hr ? "Sportaši sa završetkom" : "Athletes with finishes"}</dt><dd>{metrics.summary.athletes}</dd></div>
        <div><dt>{hr ? "Klubovi s kilometrima" : "Clubs with finishes"}</dt><dd>{metrics.summary.clubs}</dd></div>
        <div><dt>{hr ? "Klupski kilometri" : "Club kilometres"}</dt><dd>{km(metrics.summary.rawClubMetres)}</dd></div>
      </dl>
      <p className={s.small}>{hr ? "Zbrojevi prije provjere dvostrukih rezultata i pripadnosti klubovima." : "Raw totals before duplicate-result and club-attribution review."}
        {" "}{metrics.summary.duplicateAthleteRounds} {hr ? "kombinacija sportaš/kolo s više rezultata." : "athlete/round combinations have multiple results."}
      </p>
      <details className={m.details}><summary>{hr ? "Kola i pokrivenost izvora" : "Rounds and source coverage"}</summary>
        <div className={s.tableWrap}><table className={s.table}><thead><tr><th>{hr ? "Kolo" : "Round"}</th><th>{hr ? "Udaljenosti ruta" : "Course distances"}</th><th>{hr ? "Završeci" : "Finishes"}</th></tr></thead><tbody>
          {metrics.rounds.map(round => <tr key={round.id}><td>{round.slot}. {round.name}</td><td>{round.races.map(race => `${race.name}: ${race.metres === null ? "—" : km(race.metres)} km`).join(" / ")}</td><td>{round.rawFinishes}</td></tr>)}
          <tr><td>{hr ? "5. kolo" : "Round 5"}</td><td colSpan={2}>{hr ? "Još nije uključeno u ovu snimku. Konačna raspodjela čeka izvor." : "Not included in this snapshot. Final distribution awaits its source."}</td></tr>
        </tbody></table></div>
      </details>
      <Suspense fallback={<p>{hr ? "Učitavanje provjere…" : "Loading review…"}</p>}><RewardParticipationReview selection={selection} sourceHash={metrics.sourceHash} hr={hr} onUnsavedChange={setReviewUnsaved}/></Suspense>
      <div className={m.controls}><div className={s.tabs} role="group" aria-label={hr ? "Vrsta sudionika" : "Participant type"}>
        {(["athletes", "clubs"] as const).map(value => <button key={value} aria-pressed={tab === value} onClick={() => { setTab(value); setSelected(null); setPage(0); setSearch(""); }}>{value === "athletes" ? (hr ? "Sportaši" : "Athletes") : (hr ? "Klubovi" : "Clubs")}</button>)}
      </div><label className={s.field}>{hr ? "Pretraži sudionike" : "Search participants"}<input type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(0); setSelected(null); }}/></label></div>
      <div className={s.tableWrap}><table className={s.table} aria-label={tab === "clubs" ? (hr ? "Klupski doprinosi" : "Club contributions") : (hr ? "Doprinosi sportaša" : "Athlete contributions")}><thead><tr>
        <th>{tab === "clubs" ? (hr ? "Klub" : "Club") : (hr ? "Sportaš" : "Athlete")}</th><th>{hr ? "Zapisi završetaka" : "Finish rows"}</th><th>{hr ? "Poznati km" : "Known km"}</th><th>{hr ? "Detalji" : "Details"}</th>
      </tr></thead><tbody>{visible.map(row => <tr key={row.id}><td>{row.name ?? row.id}</td><td>{row.rawFinishes}</td><td>{km(row.rawMetres)}{row.missingDistances ? " + ?" : ""}</td><td><button className={s.button} onClick={() => setSelected(row.id)} aria-expanded={selected === row.id}>{hr ? "Prikaži doprinose" : "Show contributions"}</button></td></tr>)}
        {!rows.length ? <tr><td colSpan={4}>{hr ? "Nema podudaranja." : "No matching participants."}</td></tr> : null}
      </tbody></table></div>
      {rows.length > 25 ? <div className={m.pagination}><button className={s.button} disabled={page === 0} onClick={() => setPage(p => p - 1)}>{hr ? "Prethodno" : "Previous"}</button><span>{page + 1} / {Math.ceil(rows.length / 25)}</span><button className={s.button} disabled={(page + 1) * 25 >= rows.length} onClick={() => setPage(p => p + 1)}>{hr ? "Sljedeće" : "Next"}</button></div> : null}
      {selectedRow ? <section className={m.selected} aria-label={hr ? "Izvorni doprinosi" : "Source contributions"}>
        <h4>{selectedRow.name ?? selectedRow.id}</h4>
        {"finishedRounds" in selectedRow ? <p>{selectedRow.finishedRounds} {hr ? "različitih kola sa završetkom prije provjere." : "distinct rounds with a finish before review."}</p> : null}
        {issues.length ? <ul className={s.small}>{[...new Set(issues.map(issue => issue.code))].map(code => <li key={code}>{issueText(code, hr)}</li>)}</ul> : null}
        <div className={s.tableWrap}><table className={s.table}><thead><tr><th>{hr ? "Kolo / ruta" : "Round / course"}</th><th>{hr ? "Sportaš" : "Athlete"}</th><th>{hr ? "Klub u rezultatu" : "Represented club"}</th><th>km</th></tr></thead><tbody>{contributions.map(row => <tr key={row.resultId}><td>{row.round}. {row.raceName}</td><td>{row.athleteName ?? row.athleteId}</td><td>{row.clubName ?? (row.clubId ? row.clubId : (hr ? "Nije pripisano" : "Unattributed"))}</td><td>{row.metres === null ? "—" : km(row.metres)}</td></tr>)}</tbody></table></div>
      </section> : null}
      <details className={m.details}><summary>{hr ? "Provjere i izvor" : "Checks and source"}</summary><ul>
        {([...new Set(metrics.issues.map(issue => issue.code))]).map(code => <li key={code}>{metrics.issues.filter(i => i.code === code).length} · {issueText(code, hr)}</li>)}
      </ul><p>{hr ? "Bez pripisanog kluba" : "Without a represented club"}: {metrics.summary.unattributedFinishes} {hr ? "završetaka" : "finishes"} · {km(metrics.summary.rawUnattributedMetres)} km.</p>
        <p className={s.small}>{hr ? "Poveznica dokaza" : "Evidence fingerprint"}: <code className={m.hash}>{metrics.sourceHash}</code></p>
      </details>
    </> : null}
  </section>;
}

export default function RewardLeagueMetrics(props: Props) {
  return <MetricsPanel key={JSON.stringify(props.selection)} {...props}/>;
}
