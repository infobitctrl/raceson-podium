import {keccak256,type Hex} from 'viem';

/** Reuse only a successful pure hash comparison for the exact same code bytes.
 * This stores no address, chain state, identity, receipt or authorization. Callers
 * still fetch code at their current anchor and validate all immutable values. */
export function createBytecodeHashMatcher(maxEntries=32,maxCharacters=2_000_000) {
 const verified=new Map<Hex,Hex>();let characters=0;
 return (code:Hex,expected:Hex):boolean=>{
  if(verified.get(expected)===code)return true;
  if(keccak256(code)!==expected)return false;
  if(code.length>maxCharacters||maxEntries<1)return true;
  const previous=verified.get(expected);
  if(previous!==undefined){characters-=previous.length;verified.delete(expected);}
  while(verified.size>=maxEntries||characters+code.length>maxCharacters){
   const oldest=verified.keys().next().value;
   if(oldest===undefined)break;
   characters-=verified.get(oldest)!.length;verified.delete(oldest);
  }
  verified.set(expected,code);characters+=code.length;
  return true;
 };
}
export const matchesBytecodeHash=createBytecodeHashMatcher();
