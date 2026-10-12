import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('network batching is wired only to public directory/campaign reads, preserving private action readers',()=>{
 const source=readFileSync(new URL('../src/rewards-demo.ts',import.meta.url),'utf8');
 const uses=source.split('\n').filter(line=>line.includes('publicDirectoryClient'));
 assert.equal(uses.length,3,'only the import and public directory/campaign may use this reader');
 assert.match(uses.find(line=>line.includes('await dispatchPublicDirectory')),/dispatchPublicDirectory\(.+sponsorReader:config\?\.chainId===10143\?publicDirectoryClient:/);
 assert.match(uses.find(line=>line.includes('await dispatchPublicCampaign')),/dispatchPublicCampaign\(.+sponsorReader:config\?\.chainId===10143\?publicDirectoryClient:/);
 for(const route of ['dispatchDirectClaimsV5','dispatchHostedCopyReviews','dispatchSponsorExecution']){
  const line=source.split('\n').find(line=>line.includes(`await ${route}(`));
  assert.ok(line);assert.ok(!line.includes('publicDirectoryClient'));
 }
});
