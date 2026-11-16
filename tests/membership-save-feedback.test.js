import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { membershipSaveFeedback } from '../admin-src/app/shared/membership-save-feedback.js';
const receipt={userId:'fictional-member',revision:2,active:false};
test('historical deactivation replay shows newer active state, not old access denial',()=>{
 const message=membershipSaveFeedback(receipt,[{...receipt,revision:3,active:true}]);
 assert.match(message,/recorded/); assert.match(message,/account is active/); assert.doesNotMatch(message,/inactive|deactivated|blocked/);
});
test('historical activation replay shows newer revoked access',()=>{
 const message=membershipSaveFeedback({...receipt,active:true},[{...receipt,revision:3}]);
 assert.match(message,/inactive and cannot sign in/);
});
test('missing, failed, stale, and unrelated readbacks cannot assert current access',()=>{
 for (const rows of [undefined,[],[{...receipt,userId:'another-member'}],[{...receipt,revision:1}]]) {
  assert.match(membershipSaveFeedback(receipt,rows),/Current access could not be verified/);
 }
});
test('current receipt revision uses freshly read account status',()=>{
 assert.match(membershipSaveFeedback(receipt,[receipt]),/inactive/);
 assert.match(membershipSaveFeedback({...receipt,active:true},[{...receipt,active:true}]),/account is active/);
});
test('AdminTools uses refreshed members after verified receipt, not receipt state',()=>{
 const source=readFileSync(new URL('../admin-src/app/shared/AdminTools.tsx',import.meta.url),'utf8');
 assert.match(source,/const refreshedMembers = await loadMembers\(\);\s*setMessage\(membershipSaveFeedback\(row, refreshedMembers\)\)/);
 assert.match(source,/if \(check === memberCheck.current\) \{ setMembers\(rows\); return rows; \}/);
 assert.doesNotMatch(source,/setMessage\(row.active/);
});
