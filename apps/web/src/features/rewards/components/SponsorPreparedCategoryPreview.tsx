import type {RewardSponsorSelection} from "@raceson/domain/rewards/distribution-setup";
import type {useSponsorSource} from "../model/useSponsorSource";
import {sponsorPreparedCategoryPreview} from "../model/sponsorPreparedCategoryPreview";
import s from "./SponsorPreparedCategoryPreview.module.css";

export default function SponsorPreparedCategoryPreview({selection,status,hr}:{selection:RewardSponsorSelection|undefined;status:ReturnType<typeof useSponsorSource>["status"];hr:boolean}) {
 const preview=status==="signin"?sponsorPreparedCategoryPreview(selection):null;
 if(!preview)return null;
 const title=hr?"Pregled službenih kategorija nagrada":"Official reward category preview";
 return <section className={s.preview} aria-label={title}>
  <h3>{title}</h3>
  {preview.name?<p>{preview.name}</p>:null}
  <p>{hr?"Iz pripremljenog RacesOn kataloga. Prijavite se za provjeru aktualnih kategorija i postavljanje omjera nagrada. Ovaj pregled ne uključuje nagrade u kampanju.":"From the prepared RacesOn catalogue. Sign in to verify current categories and set reward ratios. This preview does not add rewards to your campaign."}</p>
  <div className={s.groups}>{preview.groups.map(group=><div key={group.id}>
   <h4>{group.name}</h4>
   <ul>{group.categories.map(category=><li key={category.id}>{category.name}</li>)}</ul>
  </div>)}</div>
 </section>;
}
