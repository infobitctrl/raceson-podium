import {apiRequest} from '@/lib/api';
import type {RewardEventSummary,RewardEventCatalogue,EventRewardResults} from '@raceson/domain/rewards/setup-event';
export async function listSetupEvents(){const response=await apiRequest<{items:RewardEventSummary[]}>({path:'/v1/rewards/setup-events',cache:'no-store'});return response.items;}
export const readSetupEvent=(id:string)=>apiRequest<RewardEventCatalogue>({path:`/v1/rewards/setup-events/${encodeURIComponent(id)}`,cache:'no-store'});
export const readSetupEventResults=(id:string,raceId:string)=>apiRequest<EventRewardResults>({path:`/v1/rewards/setup-events/${encodeURIComponent(id)}/results/${encodeURIComponent(raceId)}`,cache:'no-store'});
