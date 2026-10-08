import {concatHex,encodeAbiParameters,encodeFunctionData,getCreate2Address,keccak256,zeroAddress,type Address,type Hex,type PublicClient} from 'viem';
import {normalizeRewardClubSafeExpectation,rewardClubSafeBuild,type RewardClubSafeReader} from './club-safe.js';
import {readVerifiedRewardClubSafeDeployment,rewardClubSafeDeploymentAbi as abi,rewardClubSafeDeploymentBuild,type RewardClubSafeDeploymentReader} from './club-safe-deployment.js';
import {demand,RewardProtocolError,uint,walletAddress,type RewardChainContext} from './validation.js';

/** Public deployment records are independently pinned by code before quoting.
 * These addresses are Monad-testnet dependencies, never a recipient treasury. */
export const rewardClubSafeTestnetDependencies=Object.freeze({
 factoryAddress:'0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67' as Address,
 singletonAddress:'0x41675c099f32341bf84bfc5382af534df5c7461a' as Address,
 fallbackHandlerAddress:'0xfd0732dc9e303f09fcef3a7388ad10a83459ec99' as Address,
});
export type RewardClubSafeCreationInput={environment:RewardChainContext['environment'];chainId:number;sender:Address;owners:readonly Address[];saltNonce:bigint;
 dependencies:{factoryAddress:Address;singletonAddress:Address;fallbackHandlerAddress:Address}};
export type RewardClubSafeCreationReader=RewardClubSafeReader&Pick<PublicClient,'estimateGas'|'getGasPrice'|'getBalance'>;
function pin(value:Hex|undefined,expected:{bytes:number;hash:string}){
 demand(typeof value==='string'&&/^0x[0-9a-fA-F]+$/.test(value)&&(value.length-2)/2===expected.bytes&&keccak256(value)===expected.hash,'reward_club_creation_dependencies_changed');
}
/** The caller owns deployment intent. This function neither creates owners nor
 * proves independent control, representative authority or consent to rewards. */
export function rewardClubSafeCreationPlan(input:RewardClubSafeCreationInput,proxyCreation:Hex){
 pin(proxyCreation,rewardClubSafeDeploymentBuild.proxyCreation);
 const sender=walletAddress(input.sender),factoryAddress=walletAddress(input.dependencies.factoryAddress),singletonAddress=walletAddress(input.dependencies.singletonAddress),fallbackHandlerAddress=walletAddress(input.dependencies.fallbackHandlerAddress),saltNonce=uint(input.saltNonce);
 demand(new Set([factoryAddress,singletonAddress,fallbackHandlerAddress]).size===3,'reward_club_safe_address_mismatch');
 // Normalize against the factory only to reject sentinel/duplicate/zero owners;
 // repeat against the predicted treasury below to exclude a self-owned Safe.
 const ownerCheck=normalizeRewardClubSafeExpectation({context:{environment:input.environment,chainId:input.chainId,verifyingContract:factoryAddress},singletonAddress,fallbackHandlerAddress,owners:[...input.owners]});
 const owners=[...ownerCheck.owners];
 const initializer=encodeFunctionData({abi,functionName:'setup',args:[owners,2n,zeroAddress,'0x',fallbackHandlerAddress,zeroAddress,0n,zeroAddress]});
 const salt=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'}],[keccak256(initializer),saltNonce]));
 const address=getCreate2Address({from:factoryAddress,salt,bytecode:concatHex([proxyCreation,encodeAbiParameters([{type:'address'}],[singletonAddress])])});
 const safe=normalizeRewardClubSafeExpectation({...ownerCheck,context:{...ownerCheck.context,verifyingContract:address}});
 demand(!safe.owners.some(owner=>[factoryAddress,singletonAddress,fallbackHandlerAddress].includes(owner)),'reward_club_invalid_owners');
 return{safe,factoryAddress,sender,saltNonce,proxyCreation,initializer,initializerHash:keccak256(initializer),transaction:{chainId:safe.context.chainId,from:sender,to:factoryAddress,value:0n,
  data:encodeFunctionData({abi,functionName:'createProxyWithNonce',args:[singletonAddress,initializer,saltNonce]})}};
}
/** Read-only finalized dependencies and exact gas quote. No deployment/signing
 * occurs; already deployed addresses cannot be quoted as a new creation. */
export async function prepareRewardClubSafeCreation(reader:RewardClubSafeCreationReader,input:RewardClubSafeCreationInput,options:{sponsored?:boolean}={}){
 const copied={...input,owners:[...input.owners],dependencies:{...input.dependencies}};
 try{
  demand(await reader.getChainId()===copied.chainId,'reward_observed_chain_mismatch');
  const block=await reader.getBlock({blockTag:'finalized'});demand(block.number!==null&&block.hash!==null,'reward_finalized_block_missing');
  const at={number:uint(block.number),hash:block.hash,timestamp:uint(block.timestamp)};
  const deps=copied.dependencies;
  const codes=await Promise.all([reader.getCode({address:deps.factoryAddress,blockNumber:at.number}),reader.getCode({address:deps.singletonAddress,blockNumber:at.number}),reader.getCode({address:deps.fallbackHandlerAddress,blockNumber:at.number})]);
  [rewardClubSafeDeploymentBuild.factory,rewardClubSafeBuild.singleton,rewardClubSafeBuild.handler].forEach((expected,i)=>pin(codes[i],expected));
  const creation=await reader.readContract({address:deps.factoryAddress,abi,functionName:'proxyCreationCode',blockNumber:at.number});
  const plan=rewardClubSafeCreationPlan(copied,creation),address=plan.safe.context.verifyingContract;
  const existing=await reader.getCode({address,blockTag:'pending'});demand(!existing||existing==='0x','reward_club_creation_already_deployed');
  const [estimated,price,balance]=await Promise.all([reader.estimateGas({account:plan.sender,to:plan.factoryAddress,data:plan.transaction.data,value:0n,...(options.sponsored?{gasPrice:0n}:{})}),reader.getGasPrice(),reader.getBalance({address:plan.sender,blockTag:'pending'})]);
  const gas=(uint(estimated)*12n+9n)/10n,gasPrice=uint(price),maximumFee=gas*gasPrice;
  demand(gas>0n&&gas<=30_000_000n&&gasPrice>0n&&maximumFee<=500_000_000_000_000_000n,'reward_club_creation_gas_limit');
  if(!options.sponsored)demand(uint(balance)>=maximumFee,'reward_club_creation_gas_required');
  const [chain,canonical,head]=await Promise.all([reader.getChainId(),reader.getBlock({blockNumber:at.number}),reader.getBlock({blockTag:'finalized'})]);
  demand(chain===copied.chainId&&canonical.number===at.number&&canonical.hash===at.hash&&canonical.timestamp===at.timestamp&&head.number!==null&&head.number>=at.number&&head.timestamp>=at.timestamp,'reward_chain_changed_during_observation');
  return{plan,observedAt:at,gas,gasPrice,maximumFee,balance};
 }catch(error){if(error instanceof RewardProtocolError)throw error;throw new RewardProtocolError('reward_club_creation_unavailable');}
}
/** Finalized receipt/provenance verifies this exact creation intent. It is not
 * a treasury readiness review, key-control attestation or prize receipt. */
export async function verifyRewardClubSafeCreation(reader:RewardClubSafeDeploymentReader,input:RewardClubSafeCreationInput,hash:Hex,options:{sponsored?:boolean}={}){
 const copied={...input,owners:[...input.owners],dependencies:{...input.dependencies}};
 try{
  const block=await reader.getBlock({blockTag:'finalized'});demand(block.number!==null&&block.hash!==null,'reward_finalized_block_missing');
  const creation=await reader.readContract({address:copied.dependencies.factoryAddress,abi,functionName:'proxyCreationCode',blockNumber:block.number});
  const plan=rewardClubSafeCreationPlan(copied,creation);
  const verified=await readVerifiedRewardClubSafeDeployment(reader,{safe:plan.safe,factoryAddress:plan.factoryAddress,deploymentTransactionHash:hash,...(options.sponsored?{initializationSaltNonce:plan.saltNonce}:{})});
  demand((options.sponsored||verified.deployer===plan.sender)&&verified.saltNonce===plan.saltNonce&&verified.initializerHash===plan.initializerHash,'reward_club_creation_intent_mismatch');
  return verified;
 }catch(error){if(error instanceof RewardProtocolError)throw error;throw new RewardProtocolError('reward_club_creation_unavailable');}
}
