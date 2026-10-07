import {expect,it} from 'vitest';
import {createGuidedSetup,addGuidedGroup} from '@raceson/domain/rewards/guided-setup-editor';
import {copyExistingRoundRules,existingRoundCompatibility} from './copyExistingRoundRules';
function fixture(){let i=1;const next=()=>`93000000-0000-4000-8000-${String(i++).padStart(12,'0')}`;let c=createGuidedSetup(next);const keys:Record<string,string>={};
 for(const slot of [1,2,3])for(const key of ['women','men']){c=addGuidedGroup(c,c.root.children[slot].id,'athlete_standings',next,null);const n=c.root.children[slot].children.at(-1)!;keys[n.id]=key;n.shareBps=5000;}
 c.root.children[1].children[0].rule!.sharesBps=[8000,2000];return {c,keys};
}
it('copies only selected economics while preserving IDs, source bindings, other rounds and exact pot budgets',()=>{
 const {c,keys}=fixture(),before=JSON.stringify(c),source=c.root.children[1],target=c.root.children[2];
 const next=copyExistingRoundRules(c,source.id,[target.id],keys);
 expect(JSON.stringify(c)).toBe(before);expect(next.root.children[1]).toEqual(source);expect(next.root.children[3]).toEqual(c.root.children[3]);
 expect(next.root.children[2].shareBps).toBe(target.shareBps);expect(next.root.children[2].children.map(n=>n.id)).toEqual(target.children.map(n=>n.id));
 expect(next.root.children[2].children[0].rule!.sharesBps).toEqual([8000,2000]);expect(next.guided).toEqual(c.guided);
});
it('rejects missing classifications, league/disabled targets, locked targets and duplicate requests',()=>{
 const {c,keys}=fixture(),source=c.root.children[1],target=c.root.children[2];
 delete keys[target.children[0].id];expect(existingRoundCompatibility(c,source.id,target.id,keys)).toBe(false);
 expect(()=>copyExistingRoundRules(c,source.id,[target.id],keys)).toThrow();keys[target.children[0].id]='women';
 target.children[0].locked=true;expect(existingRoundCompatibility(c,source.id,target.id,keys)).toBe(false);target.children[0].locked=false;
 expect(()=>copyExistingRoundRules(c,source.id,[target.id,target.id],keys)).toThrow();expect(existingRoundCompatibility(c,source.id,c.root.children[0].id,keys)).toBe(false);
 target.shareBps=0;expect(existingRoundCompatibility(c,source.id,target.id,keys)).toBe(false);
});
