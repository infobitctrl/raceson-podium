import {z} from "zod";
const uuid=z.string().uuid(),hash=z.string().regex(/^[0-9a-f]{64}$/),hex=z.string().regex(/^0x[0-9a-f]+$/),wei=z.string().regex(/^(0|[1-9][0-9]*)$/);
export const sponsorTransactionSchema=z.object({chainId:z.union([z.literal(31337),z.literal(10143)]),from:z.string().regex(/^0x[0-9a-f]{40}$/),to:z.string().regex(/^0x[0-9a-f]{40}$/),value:z.literal("0"),data:hex});
export const lifecycleSchema=z.object({schema:z.literal("raceson-sponsor-lifecycle-view-v4"),approvalId:uuid,slot:z.number(),current:z.boolean(),publicationHash:hash,
 publication:z.object({id:uuid,timing:z.object({reviewPeriod:wei,reviewStartedAt:wei,officialPublishedAt:wei,publicationEvidenceHash:hex})}).nullable(),
 pot:z.object({state:z.number(),paused:z.boolean(),paidWei:wei,allocatedWei:wei,claimDeadline:wei,entitlementCount:wei}).nullable(),
 transaction:sponsorTransactionSchema.extend({action:z.enum(["upload","stage","activate"]),start:z.number().int().min(0),end:z.number().int().min(0),allocationDigest:hex,binding:z.unknown()}).nullable(),receipts:z.array(z.object({id:uuid,body:z.object({transactionHash:hex,action:z.string()})}))});
export const decodeSponsorLifecycleView=(value:unknown)=>lifecycleSchema.parse(value);
