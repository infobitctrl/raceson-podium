import assert from 'node:assert/strict';
import { openRewardTestDatabase } from './reward-test-database.mjs';
import { finaleBindingV3Scenarios } from './reward-finale-binding-v3-scenarios.mjs';
import { allocationApprovalV3Scenarios } from './reward-allocation-approval-v3-scenarios.mjs';
import { nativeFinaleV3Scenarios } from './reward-native-finale-v3-scenarios.mjs';
import { nativeContinuityV3Scenarios } from './reward-native-continuity-v3-scenarios.mjs';
import { leaguePolicyV3Scenarios } from './reward-league-policy-v3-scenarios.mjs';
import { leaguePublicationV3Scenarios } from './reward-league-publication-v3-scenarios.mjs';
import { finalAllocationV3Scenarios } from './reward-final-allocation-v3-scenarios.mjs';
import { finalAllocationActionsV3Scenarios } from './reward-final-allocation-actions-v3-scenarios.mjs';
// Deliberately scoped dependency closure, NOT a replacement for the full suite.
const harness = openRewardTestDatabase(process.argv.slice(2)); let passed = 0;
const scenario = async (name, run) => { await run(); console.log(`workflow DB scenario ${++passed}: ${name}`); };
try {
  assert.equal(await harness.scalar('select current_database()'), harness.database);
  assert.ok(['127.0.0.1', '::1'].includes(await harness.scalar('select host(inet_server_addr())')));
  assert.equal(await harness.scalar('select count(*) from app_private.reward_planning_drafts'), 0);
  const before = await harness.scalar("select rolbypassrls from pg_roles where rolname='service_role'");
  const fixture = await finaleBindingV3Scenarios({ harness, scenario });
  await allocationApprovalV3Scenarios({ harness, scenario, fixture, after: async ({ reader, chain, operator }) => {
    await nativeFinaleV3Scenarios({ harness, scenario, fixture });
    await nativeContinuityV3Scenarios({ harness, scenario, fixture });
    await leaguePolicyV3Scenarios({ harness, scenario, fixture });
    await leaguePublicationV3Scenarios({ harness, scenario, fixture });
    await finalAllocationV3Scenarios({ harness, scenario, fixture, reader });
    await finalAllocationActionsV3Scenarios({ harness, scenario, fixture, reader, chain, operator });
  } });
  assert.equal(await harness.scalar("select rolbypassrls from pg_roles where rolname='service_role'"), before);
  console.log(`Focused workflow acceptance: ${passed} SQL/owned-chain scenarios passed. Not a full database-suite result.`);
} finally { await harness.close(); }
