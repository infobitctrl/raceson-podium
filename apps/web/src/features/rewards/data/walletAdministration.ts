import {z} from 'zod';
import {apiRequest} from '@/lib/api';
const address=z.string().regex(/^0x[0-9a-f]{40}$/),fingerprint=z.string().regex(/^[0-9a-f]{64}$/);
const deployment=z.object({version:z.literal(1),appId:z.string(),walletId:z.string(),address,ownerId:z.string(),signerId:z.string(),policyId:z.string(),factory:address}).strict();
const controller=z.object({subject:z.string(),wallet:address,walletId:z.string().optional(),ownerId:z.string().optional()}).strict();
export const walletSettingsSchema=z.object({deployment,controller}).strict();
export const walletAdministrationSchema=z.object({revision:z.number().int().nonnegative(),settings:walletSettingsSchema.nullable(),fingerprint,history:z.array(z.object({revision:z.number().int(),settings:walletSettingsSchema,changed_by:z.string(),reason:z.string(),changed_at:z.string()}))}).strict();
export const walletReviewSchema=z.object({candidate:walletSettingsSchema,fingerprint,revision:z.number().int()}).strict();
export type WalletAdministration=z.infer<typeof walletAdministrationSchema>;
export type WalletReview=z.infer<typeof walletReviewSchema>;
export type WalletRole='deployment'|'controller';
export const walletCreationPreparationSchema=z.object({ownerSubject:z.string().regex(/^did:privy:/),deployment,revision:z.number().int(),fingerprint}).strict();
export type WalletCreationPreparation=z.infer<typeof walletCreationPreparationSchema>;
const path='/v1/rewards/admin/wallets';
export const readWalletAdministration=async()=>walletAdministrationSchema.parse(await apiRequest({path,cache:'no-store'}));
export const prepareWalletCreation=async(current:WalletAdministration)=>walletCreationPreparationSchema.parse(await apiRequest({path:`${path}/creation`,method:'POST',body:{expectedRevision:current.revision,expectedFingerprint:current.fingerprint}}));
export async function reviewWalletReplacement(current:WalletAdministration,role:WalletRole,walletId:string){return walletReviewSchema.parse(await apiRequest({path,method:'POST',body:{action:'review',role,walletId,expectedRevision:current.revision,expectedFingerprint:current.fingerprint}}));}
export async function activateWalletReplacement(current:WalletAdministration,role:WalletRole,walletId:string,review:WalletReview,reason:string){return walletAdministrationSchema.parse(await apiRequest({path,method:'POST',body:{action:'activate',role,walletId,expectedRevision:current.revision,expectedFingerprint:current.fingerprint,candidateFingerprint:review.fingerprint,reason}}));}
