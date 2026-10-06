import type {IncomingMessage,ServerResponse} from 'node:http';
import {loadServerEnv} from '@raceson/db';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
import {hostedCopyPreviewEnabled,hostedCopyOperationsEnabled} from '../../features/rewards/hosted-copy-preview.js';
import {readHostedCopyCatalogue} from '../../features/rewards/hosted-copy-catalogue.js';
export async function dispatchHostedCopyCatalogue(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies,read=readHostedCopyCatalogue){
 if(!['/api/v1/rewards/demo-copy/catalogue','/api/v1/rewards/public-campaigns'].includes(url.pathname)||!process.env.RACESON_REWARD_HOSTED_COPY_MODE)return false;
 deps.applyPrivateSessionHeaders(res);
 try{
  const env=loadServerEnv();
  // Live campaigns use the scoped publication reader below this preview route.
  // The preview's checked-empty directory cannot represent a funded launch.
  if(url.pathname==='/api/v1/rewards/public-campaigns'&&hostedCopyOperationsEnabled(process.env,env))return false;
  if(!hostedCopyPreviewEnabled(process.env,env)||deps.config()?.chainId!==10143||req.method!=='GET'||[...url.searchParams].length)throw Error('hosted_copy_unavailable');
  const data=await read(env),value=url.pathname.endsWith('/catalogue')?data.catalogue:data.directory;
  if(!value)throw Error('hosted_copy_unavailable');
  deps.sendSuccess(res,value);
 }catch{deps.sendError(res,503,'hosted_copy_unavailable','The verified demo catalogue is temporarily unavailable.');}
 return true;
}
