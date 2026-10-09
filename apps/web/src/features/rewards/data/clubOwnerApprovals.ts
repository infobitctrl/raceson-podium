import {z} from 'zod';
import {apiRequest} from '@/lib/api';
import {sponsorClubAwardSchema} from './sponsorClubClaims';
const cursor=z.string().regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}:0x[0-9a-f]{64}$/);
const item=z.object({cursor,creationId:z.string().uuid(),clubName:z.string().min(1),safeAddress:z.string().regex(/^0x[0-9a-f]{40}$/),award:sponsorClubAwardSchema}).strict();
export type ClubOwnerAward=z.infer<typeof item>;
export async function clubOwnerAwards(after:string|null=null){
 const page=z.object({items:z.array(item).max(25),nextCursor:cursor.nullable()}).strict().parse(await apiRequest({
  path:`/v1/club/rewards/owner-awards${after?`?after=${encodeURIComponent(cursor.parse(after))}`:''}`,cache:'no-store',
 }));
 if(new Set(page.items.map(i=>i.cursor)).size!==page.items.length||page.nextCursor&&page.nextCursor!==page.items.at(-1)?.cursor)throw Error('invalid_club_owner_awards');
 return page;
}
