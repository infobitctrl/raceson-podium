import {setupId} from './distribution-setup.js';

export type SupportSettings = {gasAlertWei: string | null; supportWallet: string | null; supportLimitWei: string};
export type SupportSnapshot = {revision: number; settings: SupportSettings; history: {revision: number; settings: SupportSettings; changedBy: string; changedAt: string; reason: string}[]};
export type ReviewIssue = {id: string; description: string; createdBy: string; createdAt: string; withdrawnAt: string | null; canWithdraw: boolean};
export type ReviewIssues = {revision: number; contextHash: string; canReport: boolean; issues: ReviewIssue[]};
export type IssueChange = {action: 'report'; requestId: string; expectedRevision: number; contextHash: string; description: string} | {action: 'withdraw'; requestId: string; expectedRevision: number; issueId: string};
export const emptySupportSettings: SupportSettings = {gasAlertWei: null, supportWallet: null, supportLimitWei: '0'};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).sort().join() === names.sort().join();
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const amount = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,24})$/.test(v);
const timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function decodeSupportSettings(v: unknown): SupportSettings {
 if (!object(v) || !keys(v, ['gasAlertWei','supportWallet','supportLimitWei']) || !(v.gasAlertWei === null || amount(v.gasAlertWei)) || !amount(v.supportLimitWei)
  || !(v.supportWallet === null || typeof v.supportWallet === 'string' && /^0x[0-9a-f]{40}$/.test(v.supportWallet) && v.supportWallet !== '0x'+'0'.repeat(40))
  || v.supportWallet === null && v.supportLimitWei !== '0') throw Error('invalid_reward_support_settings');
 return v as SupportSettings;
}
export function decodeSupportSnapshot(v: unknown): SupportSnapshot {
 if (!object(v) || !keys(v,['revision','settings','history']) || !revision(v.revision) || !Array.isArray(v.history) || v.history.length > 50) throw Error('invalid_reward_support_settings');
 decodeSupportSettings(v.settings);
 for (const h of v.history) {
  if (!object(h) || !keys(h,['revision','settings','changedBy','changedAt','reason']) || !revision(h.revision) || h.revision > v.revision || !setupId(h.changedBy) || !timestamp(h.changedAt) || typeof h.reason !== 'string') throw Error('invalid_reward_support_settings');
  decodeSupportSettings(h.settings);
 }
 return v as SupportSnapshot;
}
export function decodeIssueChange(v: unknown): IssueChange {
 if (!object(v) || !setupId(v.requestId) || !revision(v.expectedRevision)) throw Error('invalid_reward_review_issue');
 if (v.action === 'report' && keys(v,['action','requestId','expectedRevision','contextHash','description']) && typeof v.contextHash === 'string' && /^[0-9a-f]{64}$/.test(v.contextHash)
  && typeof v.description === 'string' && v.description.trim().length >= 8 && v.description.trim().length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v.description)) return {...v, description:v.description.trim()} as IssueChange;
 if (v.action === 'withdraw' && keys(v,['action','requestId','expectedRevision','issueId']) && setupId(v.issueId)) return v as IssueChange;
 throw Error('invalid_reward_review_issue');
}
export function decodeReviewIssues(v: unknown): ReviewIssues {
 if (!object(v) || !keys(v,['revision','contextHash','canReport','issues']) || !revision(v.revision) || typeof v.contextHash !== 'string' || !/^[0-9a-f]{64}$/.test(v.contextHash) || typeof v.canReport !== 'boolean' || !Array.isArray(v.issues) || v.issues.length > 100) throw Error('invalid_reward_review_issue');
 const ids = new Set<string>();
 for (const i of v.issues) {
  if (!object(i) || !keys(i,['id','description','createdBy','createdAt','withdrawnAt','canWithdraw']) || !setupId(i.id) || ids.has(i.id) || !setupId(i.createdBy) || !timestamp(i.createdAt) || !(i.withdrawnAt === null || timestamp(i.withdrawnAt)) || typeof i.canWithdraw !== 'boolean' || i.withdrawnAt !== null && i.canWithdraw || typeof i.description !== 'string' || i.description.length > 2000) throw Error('invalid_reward_review_issue');
  ids.add(i.id);
 }
 return v as ReviewIssues;
}
