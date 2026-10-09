import {beforeEach,expect,it,vi} from 'vitest';
import {getRewardMemberClubs} from './clubMemberships';
const m=vi.hoisted(()=>({api:vi.fn()}));vi.mock('@/lib/api',()=>({apiRequest:m.api}));
const id=(n:number)=>`73000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const club={clubId:id(2),name:'My club',role:'member',canSign:false};
beforeEach(()=>m.api.mockReset().mockResolvedValue({items:[club],nextCursor:null}));
it('reads only the authenticated membership page, with bounded cursor and no requested authority',async()=>{
 expect((await getRewardMemberClubs(id(1))).items[0]).toEqual(club);expect(m.api).toHaveBeenCalledWith({path:'/v1/club/rewards/my-clubs?after='+id(1),cache:'no-store'});
 await expect(getRewardMemberClubs('not-a-cursor')).rejects.toThrow();expect(m.api).toHaveBeenCalledOnce();
});
it.each([{items:[club,club],nextCursor:null},{items:[club],nextCursor:id(3)},{items:[{...club,canSign:'true'}],nextCursor:null},{items:[{...club,privateData:'extra'}],nextCursor:null}])('rejects malformed or duplicate private discovery data',async page=>{m.api.mockResolvedValue(page);await expect(getRewardMemberClubs()).rejects.toThrow();});
it('rejects rows preceding the requested page',async()=>{await expect(getRewardMemberClubs(id(3))).rejects.toThrow();});
