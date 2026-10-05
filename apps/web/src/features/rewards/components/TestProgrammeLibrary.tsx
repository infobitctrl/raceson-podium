import {useEffect,useState} from "react";
import {Link} from "react-router-dom";
import {useI18n} from "@/shared/i18n/I18nContext";
import type {SavedTestProgramme} from "@raceson/domain/rewards/test-programme";
import {listTestProgrammes} from "../data/testProgrammes";
import ui from "../screens/RewardCatalogue.module.css";
import styles from "./RewardWorkspace.module.css";
export default function TestProgrammeLibrary(){
 const {locale}=useI18n(),hr=locale==="hr",[rows,setRows]=useState<SavedTestProgramme[]|null>(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{let current=true;setRows(null);setFailed(false);void listTestProgrammes().then(value=>{if(current)setRows(value);}).catch(()=>{if(current)setFailed(true);});return()=>{current=false;};},[retry]);
 return <section aria-labelledby="saved-test-title"><div className={styles.sectionHeading}><h2 id="saved-test-title">{hr?"Moji testni programi":"My test programmes"}</h2></div>
 {failed?<p role="alert">{hr?"Testove nije moguće učitati.":"Tests could not be loaded."} <button className="underline" onClick={()=>setRetry(n=>n+1)}>{hr?"Pokušaj ponovno":"Try again"}</button></p>:rows===null?<p role="status">{hr?"Učitavanje testova…":"Loading tests…"}</p>:rows.length?<div className={ui.grid}>{rows.map(r=><Link className={ui.card} key={r.id} to={`/rewards/test?test=${r.id}`}><span className={ui.pill}>{hr?"Privatna simulacija":"Private simulation"}</span><h3>{r.configuration.name}</h3><small>{r.configuration.order.length} {hr?"kola":"rounds"} · {r.configuration.order[0].length} {hr?"testnih sportaša":"test athletes"}</small><strong>{new Intl.NumberFormat(locale).format(r.configuration.budgetMon)}</strong><small>test MON · {hr?"planirani fond":"planned pot"}</small></Link>)}</div>:<p className={ui.empty}>{hr?"Još nema spremljenih testova. Kreirajte prvi test s dva kola i deset sportaša.":"No saved tests yet. Create your first test with two rounds and ten athletes."}</p>}
 </section>;
}
