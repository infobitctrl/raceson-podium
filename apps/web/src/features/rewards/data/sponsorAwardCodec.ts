import {z} from 'zod';
const uuid=z.string().uuid(),hex=z.string().regex(/^0x[0-9a-f]{64}$/),wei=z.string().regex(/^(0|[1-9][0-9]*)$/);
export const sponsorAwardSchema=z.object({approvalId:uuid,slot:z.number().int().min(0).max(5),entitlementId:hex,amountWei:wei,athleteProfileId:uuid.nullable(),claims:z.array(z.object({id:uuid,prepared:z.boolean(),consented:z.boolean(),approved:z.boolean(),paid:z.boolean()}).strict())}).strict();
