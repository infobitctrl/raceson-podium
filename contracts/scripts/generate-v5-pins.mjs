import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {keccak256} from 'viem';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
// Recompile the entire graph together: immutable AST IDs are build-dependent.
execFileSync(resolve(root,'contracts/.toolchain/foundry-v1.8.0/forge'),['build','--root',resolve(root,'contracts'),'--offline','--force','--no-lint'],{cwd:root,stdio:'inherit'});
const names={};
function walk(v){if(!v||typeof v!=='object')return;if(v.nodeType==='VariableDeclaration'&&v.mutability==='immutable')names[v.id]=v.name;for(const child of Object.values(v)){if(Array.isArray(child))child.forEach(walk);else if(typeof child==='object')walk(child);}}
for(const dir of readdirSync(resolve(root,'contracts/out'),{withFileTypes:true}).filter(d=>d.isDirectory()))for(const f of readdirSync(resolve(root,'contracts/out',dir.name)).filter(n=>n.endsWith('.json'))){const a=JSON.parse(readFileSync(resolve(root,'contracts/out',dir.name,f)));walk(a.ast);}
const builds={};
for(const [key,name] of Object.entries({sponsorProgrammeBuildV5:'RacesOnRewardProgrammeV5',sponsorCampaignBuildV5:'RacesOnRewardCampaignV5',sponsorFactoryBuildV5:'RacesOnSponsorFactoryV5',walletRegistryBuildV1:'RacesOnWalletRegistryV1'})){
 const a=JSON.parse(readFileSync(resolve(root,`contracts/out/${name}.sol/${name}.json`)));
 const offsets=Object.fromEntries(Object.entries(a.deployedBytecode.immutableReferences??{}).map(([id,list])=>{if(!names[id])throw Error(`Missing immutable ${id}`);return[names[id],list.map(r=>r.start)];}));
 builds[key]={creationCodeHash:keccak256(a.bytecode.object),runtimeTemplateHash:keccak256(a.deployedBytecode.object),runtimeBytes:(a.deployedBytecode.object.length-2)/2,offsets,bytecode:a.bytecode.object};
}
writeFileSync(resolve(root,'packages/rewards-chain/src/sponsor-v5-build.ts'),'// Pinned Solidity 0.8.36 / Foundry 1.8.0 / optimizer 200 / viaIR / Cancun.\n// Generated from the original contract artifacts; verified by integration tests.\n'+Object.entries(builds).map(([k,b])=>`export const ${k} = ${JSON.stringify(b,null,2)} as const;`).join('\n')+'\n');
console.log(Object.fromEntries(Object.entries(builds).map(([k,v])=>[k,{runtimeBytes:v.runtimeBytes,creationCodeHash:v.creationCodeHash}])));
