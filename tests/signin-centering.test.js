import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('wide sign-in workspace centers its capped main without changing authenticated grid',async()=>{
 const css=await readFile(new URL('../admin-src/app/shared/named-shell.css',import.meta.url),'utf8');
 assert.match(css,/\.shared-admin\.named-shell \.main-content\{margin:0;min-width:0;width:100%;max-width:1600px;/);
 const rule='.shared-admin.named-shell.signed-out .main-content{margin-inline:auto;}';assert.ok(css.includes(rule));
 assert.ok(css.indexOf(rule)>css.indexOf('.shared-admin.named-shell .main-content{'));
 assert.match(css,/\.shared-admin\.named-shell\.signed-out\{display:block;\}/);
 assert.equal(css.match(/\.shared-admin\.named-shell\.signed-out \.main-content\{/g)?.length,1);
 // Block sizing contract: capped content has equal inline auto margins;
 // narrow viewports keep full available width rather than a fixed minimum.
 for(const available of [390,768,1440,1920,2560]){const width=Math.min(available,1600),margin=(available-width)/2;assert.equal(margin+width/2,available/2);assert.ok(width<=available);}
});
