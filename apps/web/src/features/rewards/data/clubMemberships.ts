import {z} from 'zod';
import {apiRequest} from '@/lib/api';
const uuid=z.string().uuid();
const item=z.object({clubId:uuid,name:z.string().min(1),role:z.enum(['manager','member']),canSign:z.boolean()}).strict();
export type RewardMemberClub=z.infer<typeof item>;
export async function getRewardMemberClubs(after:string|null=null,accessToken?:string){
 const page=z.object({items:z.array(item).max(25),nextCursor:uuid.nullable()}).strict().parse(await apiRequest({
  path:`/v1/club/rewards/my-clubs${after?`?after=${encodeURIComponent(uuid.parse(after))}`:''}`,cache:'no-store',...(accessToken?{accessToken}:{}),
 }));
 if(new Set(page.items.map(c=>c.clubId)).size!==page.items.length||page.items.some(c=>after!==null&&c.clubId<=after)||page.nextCursor&&page.nextCursor!==page.items.at(-1)?.clubId)throw Error('invalid_club_memberships');
 return page;
}
