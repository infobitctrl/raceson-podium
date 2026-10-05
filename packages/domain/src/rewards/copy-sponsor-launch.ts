import type {SponsorLaunch} from './sponsor-launch.js';
/** Display evidence from the copy-specific server boundary. It is never supplied
 * to execution APIs as permission to sign, fund or approve an allocation. */
export type CopySponsorLaunchBinding={version:'copy-launch-v1';setupId:string;launchId:string;revision:number;configurationHash:string;sourceFingerprint:string};
export function decodeCopySponsorLaunchBinding(value:unknown,launch:SponsorLaunch):CopySponsorLaunchBinding{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_copy_launch_binding');
 const b=value as CopySponsorLaunchBinding;
 if(Object.keys(b).sort().join()!==['version','setupId','launchId','revision','configurationHash','sourceFingerprint'].sort().join()
  ||b.version!=='copy-launch-v1'||launch.setup.chainId!==10143||b.setupId!==launch.setup.id||b.launchId!==launch.id
  ||b.revision!==launch.setup.revision||b.configurationHash!==launch.configurationHash
  ||typeof b.sourceFingerprint!=='string'||!/^[0-9a-f]{64}$/.test(b.sourceFingerprint))throw Error('invalid_copy_launch_binding');
 return b;
}
