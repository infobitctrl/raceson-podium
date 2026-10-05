import {createAdminSupabaseClient,type ServerEnv} from '@raceson/db';
import {readFiveRoundCopyV1} from '@raceson/db/rewards';
import {decodeCopyCatalogue} from '@raceson/domain/rewards/copy-catalogue';
import {hostedCopyPin} from './hosted-copy-preview.js';

export async function readHostedCopyCatalogue(env:ServerEnv,rpc=()=>createAdminSupabaseClient(env).rpc('service_reward_demo_copy_catalogue'),pin=hostedCopyPin){
 const {data,error}=await rpc();
 if(error||!data)throw Error('hosted_copy_unavailable');
 const source=await readFiveRoundCopyV1(pin,async()=>data.source);
 const catalogue=decodeCopyCatalogue({...data.metadata,sourceLeagueId:source.leagueId,sourceSeasonId:source.seasonId,checkedAt:data.checkedAt});
 if(catalogue.categories.some(c=>!source.classifications.some(s=>s.id===c.id&&s.competitionId===c.competitionId&&s.name===c.name))
  ||catalogue.rounds.some(r=>r.tracks.some(t=>!source.races.some(s=>s.id===t.raceId&&s.roundId===r.roundId&&s.slot===r.slot&&s.competitionId===t.competitionId&&s.distanceMetres===t.distanceMetres))))throw Error('hosted_copy_unavailable');
 // An empty directory is a checked database fact. Never hide an existing launch
 // by returning zero statistics if the hosted slice's capabilities change.
 const directory=data.hasLaunches===false?{chainId:10143,items:[],sponsors:0,checkedAt:catalogue.checkedAt,refreshStatus:'current'}:null;
 return {catalogue,directory};
}
