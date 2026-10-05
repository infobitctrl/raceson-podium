import {z} from 'zod';
const amount=z.string().regex(/^(0|[1-9][0-9]*)$/);
export const resultDisplaySchema=z.object({name:z.string(),estimated:z.boolean(),blocked:z.boolean(),allocatedWei:amount,retainedWei:amount,sourceAvailable:z.boolean(),scope:z.enum(['race','league']),
 recipientTotals:z.array(z.object({key:z.string(),name:z.string().nullable(),kind:z.enum(['athlete','club']),categoryCount:z.number().int().nonnegative(),amountWei:amount.nullable()})).optional(),
 distribution:z.array(z.object({id:z.string(),name:z.string(),budgetWei:amount,allocatedWei:amount,retainedWei:amount,held:z.boolean(),prizes:z.array(z.object({rank:z.number().int().positive().max(100),amountWei:amount}))})).optional(),rows:z.array(z.object({
 key:z.string(),rank:z.number().int().positive().nullable(),name:z.string().nullable(),club:z.string().nullable(),race:z.string(),categories:z.array(z.string()),points:z.number().int().nonnegative().nullable().optional(),timeMs:z.number().nonnegative().nullable(),status:z.string(),amountWei:amount.nullable(),kind:z.enum(['athlete','club']),
})).max(10000)});
export type ResultDisplay=z.infer<typeof resultDisplaySchema>;
