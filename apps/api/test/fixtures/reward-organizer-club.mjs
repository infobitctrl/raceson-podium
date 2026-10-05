import assert from "node:assert/strict";
import { clubReviewFixture, clubReviewId as id } from "./reward-club-review.mjs";
export function organizerClubFixture() {
  const f = clubReviewFixture(), config = { chainId: 31337, origin: "http://127.0.0.1:3101" };
  const labels = { clubName: "Synthetic trail club", ownerProfileId: id(20), ownerName: "Synthetic club owner" };
  const item = { requestId: f.input.requestId, clubId: f.context.nomination.clubId, clubName: labels.clubName,
    address: f.context.nomination.candidate.safeAddress, requestedAt: f.context.nomination.requestedAt, nominationStatus: "pending_review" };
  const page = { programmeId: f.input.programmeId, chainId: 31337, items: [item], nextCursor: null }, base = f.rpc;
  const rpc = async (name, args) => {
    if (!["service_list_reward_operator_club_treasuries", "service_read_reward_operator_club_treasury"].includes(name)) return base(name, args);
    f.calls.push({ name, args: structuredClone(args) });
    assert.equal(args.p_actor_user_id, f.identity.userId); assert.equal(args.p_actor_session_id, f.identity.sessionId);
    assert.equal(args.p_programme_id, f.input.programmeId); assert.equal(args.p_chain_id, config.chainId);
    return { data: structuredClone(name === "service_list_reward_operator_club_treasuries" ? page : { context: f.context, labels }), error: null };
  };
  return { ...f, config, labels, item, page, rpc, options: { ...config, reader: f.chain.reader, rpc } };
}
