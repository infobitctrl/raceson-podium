import {apiRequest} from '@/lib/api';
import {publicEnv} from '@/lib/public-env';
import {sponsorAwardSchema} from './sponsorAwardCodec';
import {z} from 'zod';
const cursor=z.string().regex(/^0x[0-9a-f]{64}$/);
const page=z.object({items:z.array(sponsorAwardSchema).max(50),nextCursor:cursor.nullable()}).strict();
export async function getHostedAthleteAwards(after:string|null=null){
 if(!publicEnv.rewardPortalEnabled||!publicEnv.hostedOperations)throw Error('rewards_disabled');
 if(after!==null)cursor.parse(after);
 const v=page.parse(await apiRequest({path:`/v1/rewards/demo-copy/athlete-awards${after?`?after=${after}`:''}`,cache:'no-store'}));
 let previous=after;
 for(const item of v.items){if(previous!==null&&item.entitlementId<=previous)throw Error('invalid_claim');previous=item.entitlementId;}
 if(v.nextCursor!==null&&(v.items.length!==50||v.nextCursor!==previous))throw Error('invalid_claim');
 return v;
}
