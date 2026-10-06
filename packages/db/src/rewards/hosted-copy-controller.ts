import type {RewardLedgerRpc} from './programme-ledger.js';
/** Only an independently authenticated native Privy actor may construct this transport. */
export function hostedCopyControllerRpc(actor:{subject:string;wallet:string},rpc:RewardLedgerRpc):RewardLedgerRpc {
 if(!/^did:privy:[a-zA-Z0-9_-]{1,100}$/.test(actor.subject)||!/^0x[0-9a-f]{40}$/.test(actor.wallet))throw Error('controller_scope_required');
 return async(name,args)=>{
  if(args.p_subject!==actor.subject)throw Error('controller_scope_required');
  if(name==='service_reward_controller_v4'){
   const keys=['p_operator','p_subject','p_chain_id','p_setup_id','p_approval_id','p_request_id','p_receipt'];
   if(args.p_operator!==actor.wallet||args.p_chain_id!==10143||Object.keys(args).some(k=>!keys.includes(k)))throw Error('controller_scope_required');
   const {p_chain_id:_,...bounded}=args;return rpc('service_reward_demo_copy_controller',bounded);
  }
  if(name==='service_reward_demo_copy_settlement'){
   const keys=['p_subject','p_sender','p_setup_id','p_slot','p_action','p_input'];
   if(args.p_sender!==actor.wallet||Object.keys(args).some(k=>!keys.includes(k)))throw Error('controller_scope_required');
   return rpc(name,args);
  }
  if(name==='service_reward_controller_transaction'){
   const keys=['p_subject','p_sender','p_action','p_id','p_context','p_transaction','p_signed','p_hash'];
   if(args.p_sender!==actor.wallet||Object.keys(args).some(k=>!keys.includes(k)))throw Error('controller_scope_required');
   return rpc('service_reward_demo_copy_controller_transaction',args);
  }
  throw Error('controller_scope_required');
 };
}
