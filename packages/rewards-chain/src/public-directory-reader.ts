import type {SponsorChainReader} from './sponsor-v4.js';

/** One public refresh, one finalized snapshot. Sharing its bytecode reads lets
 * staggered observers batch at the same block. Nothing survives this refresh;
 * numbered block and chain checks still reach the reader to detect a reorg.
 * Never use this reader for a wallet action or receipt recording. */
export function createPublicDirectoryReader(reader:SponsorChainReader):SponsorChainReader {
 let finalized:ReturnType<SponsorChainReader['getBlock']>|undefined;
 let anchor:bigint|null= null;
 const code=new Map<string,ReturnType<SponsorChainReader['getCode']>>();
 // Only the default header shape is shared; preserve viem's generic return
 // shape for callers explicitly requesting full transactions or another tag.
 const getBlock=((parameters:Parameters<SponsorChainReader['getBlock']>[0])=>{
  if(parameters?.blockTag!=='finalized'||parameters.includeTransactions)return reader.getBlock(parameters);
  finalized??=reader.getBlock(parameters).then(block=>{anchor=block.number;return block;});
  return finalized;
 }) as SponsorChainReader['getBlock'];
 return {
  getChainId:()=>reader.getChainId(),
  getBlock,
  getCode:parameters=>{
   if(anchor===null||parameters.blockNumber!==anchor)return reader.getCode(parameters);
   const key=parameters.address.toLowerCase();
   let pending=code.get(key);
   if(!pending){pending=reader.getCode(parameters);code.set(key,pending);}
   return pending;
  },
  getTransaction:parameters=>reader.getTransaction(parameters),
  getTransactionReceipt:parameters=>reader.getTransactionReceipt(parameters),
  readContract:parameters=>reader.readContract(parameters),
  getBalance:parameters=>reader.getBalance(parameters),
 };
}
