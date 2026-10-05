// Focused SQL acceptance: all migrations plus synthetic sponsor-source scenarios.
// Does not depend on the separate portal's demo.sql fixture or modify retained data.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const args=process.argv.slice(2);
assert.ok(args.length===0 || args.length===1&&['--all-rewards','--operations'].includes(args[0]),'Usage: reward-sponsor-source-db.mjs [--all-rewards|--operations]');
const allRewards=args[0]==='--all-rewards', operations=args[0]==='--operations';
const directory=mkdtempSync(join(tmpdir(),'podium-source-validation-'));
try {
 const original=readFileSync(join(root,'packages/db/scripts/validate-migrations.sh'),'utf8');
 const rootLine='ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)"';
 const marker='if [ -n "$IMPORT_REHEARSAL_FILE" ]; then';
 assert.equal(original.split(rootLine).length,2);
 // Retain migration ordering, Supabase stubs, migration-specific assertions,
 // loopback restrictions, PID-owned scratch name and cleanup. The remaining
 // portal-wide fixture/smoke suite is deliberately outside this scoped test.
 const boundary=original.indexOf(marker,original.indexOf('done < "$MIGRATION_SOURCE_LIST"'));
 assert.ok(boundary>0);
 const runner=join(directory,'scenarios.mjs');
 const moduleUrl=path=>JSON.stringify(pathToFileURL(join(root,path)).href);
 writeFileSync(runner,allRewards
  ? `await import(${moduleUrl('packages/db/scripts/reward-db-integration.mjs')});\n`
  : `import {openRewardTestDatabase} from ${moduleUrl('packages/db/scripts/reward-test-database.mjs')};
import {${operations?'sponsorAllocationV4Scenarios':'sponsorSourceV4Scenarios'} as selectedScenarios} from ${moduleUrl(operations?'packages/db/scripts/reward-sponsor-allocation-v4-scenarios.mjs':'packages/db/scripts/reward-sponsor-source-v4-scenarios.mjs')};
const harness=openRewardTestDatabase(process.argv.slice(2));let passed=0;
try {await selectedScenarios({harness,scenario:async(name,run)=>{await run();passed++;console.log('PASS '+name);}});console.log('Sponsor source SQL acceptance: '+passed+' passed');} finally {await harness.close();}
`);
 const quote=value=>`'${value.replaceAll("'","'\\''")}'`;
 const script=original.slice(0,boundary).replace(rootLine,`ROOT_DIR=${quote(root)}`)+`
[ "$REWARD_DEMO_VALIDATION" -eq 1 ]
[ "$("$PG_BIN/psql" -X -h "$PGHOST" -p 5432 -d postgres -Atqc "select inet_server_addr() in ('127.0.0.1'::inet,'::1'::inet) and inet_server_port()=5432")" = t ]
"$PG_BIN/psql" -X -h "$PGHOST" -p 5432 -d postgres -v ON_ERROR_STOP=1 -qc "create database $LOCAL_DB_NAME"
LOCAL_DB_CREATED=1
if ! "$PG_BIN/psql" -X --echo-errors -h "$PGHOST" -p 5432 -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 -f "$COMBINED_MIGRATION_FILE" >"$LOG_FILE" 2>&1; then cat "$LOG_FILE"; exit 1; fi
node ${quote(runner)} "$PG_BIN/psql" "$PGHOST" "$LOCAL_DB_NAME"
`;
 const path=join(directory,'validate.sh');writeFileSync(path,script);
 execFileSync('sh',[path],{cwd:root,stdio:'inherit',env:{PATH:process.env.PATH,LANG:'C',RACESON_REWARD_DEMO_VALIDATION:'1',RACESON_REWARD_CHAIN_REHEARSAL:'0'}});
} finally {rmSync(directory,{recursive:true,force:true});}
