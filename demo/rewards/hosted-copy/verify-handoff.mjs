import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

function canonical(value) {
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>`${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 throw Error('Invalid JSON value');
}
/** expectedHash must come from the authenticated sponsor view or separately
 * retained evidence. A checksum is content integrity, never controller consent. */
export function verifyHandoff(value,expectedHash) {
 if(!/^[0-9a-f]{64}$/.test(expectedHash??'')||value?.version!=='podium-copy-review-handoff-v1')throw Error('Expected a review handoff and a separately recorded SHA-256');
 const d=value.document,actual=createHash('sha256').update(canonical(d)).digest('hex');
 if(actual!==expectedHash||value.documentHash!==expectedHash)throw Error('Review record checksum mismatch');
 if(d.version!=='podium-copy-review-document-v1'||d.chainId!==10143||d.state!=='unapproved'||d.payableWei!=='0'
  ||d.allocation.state!=='unapproved'||d.allocation.payableWei!=='0'
  ||d.allocation.setupId!==d.setup.id||d.allocation.revision!==d.setup.revision
  ||d.allocation.sourceHash!==d.source.projectionSha256
  ||createHash('sha256').update(canonical(d.setup.configuration)).digest('hex')!==d.allocation.configurationHash)throw Error('Invalid review context');
 const a=d.allocation,amounts=[a.budgetWei,a.proposedWei,a.heldWei,a.unallocatedWei,a.unusedWei];
 if(amounts.some(v=>typeof v!=='string'||!/^\d+$/.test(v))||BigInt(a.budgetWei)!==BigInt(a.proposedWei)+BigInt(a.heldWei)+BigInt(a.unallocatedWei)+BigInt(a.unusedWei))throw Error('Invalid review accounting');
 return {documentHash:actual,setupId:d.setup.id,revision:d.setup.revision,chainId:10143,state:'unapproved',payableWei:'0',budgetWei:a.budgetWei,proposedWei:a.proposedWei};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  const [file,flag,expectedHash,...extra]=process.argv.slice(2);
  if(!file||flag!=='--expected-sha256'||!expectedHash||extra.length)throw Error('Usage: node verify-handoff.mjs <private-record.json> --expected-sha256 <digest from sponsor view>');
  if((await stat(file)).size>2*1024*1024)throw Error('Review file exceeds 2 MiB');
  const summary=verifyHandoff(JSON.parse(await readFile(file,'utf8')),expectedHash);
  console.log(JSON.stringify({...summary,notice:'Content matches the recorded digest. This is not approval, a signature or a payment receipt.'},null,2));
 }catch(error){console.error(error instanceof Error?error.message:'Verification failed');process.exitCode=1;}
}
